import { describe, expect, it } from 'vitest'
import { buildQueries, JUDGE_COUNT, mergeFound, proseOf, rankCandidates, searchTerms, tokenize, worthJudging } from '../../netlify/shared/duplicate-rank'
import { parseSearch } from '../../netlify/shared/github-search'
import recorded from '../fixtures/vscode-334721.json'

/** A real search for microsoft/vscode #334721, recorded on 2026-10-09 (20 distinct issues, bodies cut to 1,500 characters). */
const target = { number: 334721, title: recorded.issue.title, body: recorded.issue.body }
const found = mergeFound(parseSearch(recorded.strict), parseSearch(recorded.broad))

describe('tokenize', () => {
  it('lowercases, stems plurals, and drops stopwords, short words, hashes, build ids and long numbers', () => {
    expect(tokenize('The menus crashes when I click Ctrl+Space, a44adf7f 03t05 26200 136 v8')).toEqual(['menu', 'crash', 'click', 'ctrl', 'space', '136', 'v8'])
  })

  it('splits identifiers at underscores so fish_history meets fish and history', () => {
    expect(tokenize('fish_history')).toEqual(['fish', 'history'])
  })
})

describe('searchTerms and buildQueries', () => {
  it('picks the title words, rarest first, and leaves the repo name out', () => {
    expect(searchTerms('[Vite 8] Error importing SASS module on Windows', '', 'vitejs/vite')).toEqual(['windows', 'sass', 'module', 'importing'])
  })

  it('puts nouns before verbs and generic words, and caps the list at five', () => {
    expect(searchTerms(target.title, target.body, 'microsoft/vscode')).toEqual(['compact', 'menu', 'open', 'hamburger', 'clicked'])
  })

  it('reads body words only when the title has fewer than three', () => {
    expect(searchTerms('Crash', 'The tooltip flickers on hover in the sidebar', 'a/b')).toEqual(['flickers', 'tooltip', 'sidebar', 'hover', 'crash'])
  })

  it('builds one strict query on the two rarest words and one broad query on all of them', () => {
    expect(buildQueries('microsoft/vscode', ['compact', 'menu', 'open'])).toEqual({
      strict: 'repo:microsoft/vscode is:issue compact menu in:title,body',
      broad: 'repo:microsoft/vscode is:issue (compact OR menu OR open) in:title,body',
    })
  })
})

describe('proseOf', () => {
  it('drops comments, links, details blocks and everything from the machine-info section on', () => {
    const body = 'Menu does not open <!-- template -->\nSee https://example.com/x\n<details><summary>System Info</summary>GPU intel</details>\n### System Info\nubuntu arm64'
    expect(proseOf(body).replace(/\s+/g, ' ').trim()).toBe('Menu does not open See')
  })
})

describe('rankCandidates on the recorded search', () => {
  const ranked = rankCandidates(target, found, 5)

  it('never lists the issue itself and ranks the two verified duplicates in the top two', () => {
    expect(ranked.map((c) => c.number)).toEqual([334403, 334776, 332309, 337503, 110720])
    expect(ranked.every((c) => c.number !== target.number)).toBe(true)
  })

  it('orders by score, and the scores are the rounded cosine of rare-term weights', () => {
    expect(ranked.map((c) => c.score)).toEqual([0.263, 0.129, 0.123, 0.117, 0.117])
    expect(ranked[0].sharedTerms).toEqual(['136', 'button', 'hamburger', 'selection', 'compact', 'open'])
    expect(ranked[0]).toMatchObject({ state: 'closed', stateReason: 'duplicate', judgement: null })
  })

  it('is deterministic: the same input gives the same list in any input order', () => {
    expect(rankCandidates(target, [...found].reverse(), 5)).toEqual(ranked)
  })

  it('judges only candidates with a score of 0.12 and two shared words, at most three', () => {
    const judged = ranked.filter(worthJudging).slice(0, JUDGE_COUNT)
    expect(judged.map((c) => c.number)).toEqual([334403, 334776, 332309])
    expect(worthJudging({ ...ranked[0], score: 0.119 })).toBe(false)
    expect(worthJudging({ ...ranked[0], sharedTerms: ['one'] })).toBe(false)
  })
})
