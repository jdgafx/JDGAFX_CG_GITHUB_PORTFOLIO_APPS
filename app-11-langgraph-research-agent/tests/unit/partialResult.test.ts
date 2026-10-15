import { describe, expect, it } from 'vitest'
import type { ResearchValues } from '../../netlify/shared/graph/state'
import { partialResult } from '../../netlify/shared/graph/stream'
import { BUDGET_MESSAGE } from '../../netlify/shared/openrouter'

// What a stopped run delivers when the guard or a failed step cuts it short. A draft the critic already
// sent back (verdict revise) must never ship as the answer — the visitor gets the no-answer ending with
// the pages read instead. An unreviewed draft (no verdict on it yet) still ships, honestly labelled.

const MS = 27_000

const NPM_PAGE = { n: 1, title: 'npm - npm', url: 'https://www.npmjs.com/package/npm', extract: '12.2.0 · Public · Publish.' }
const CHANGELOG = { n: 2, title: 'cli/CHANGELOG.md', url: 'https://github.com/npm/cli/blob/latest/CHANGELOG.md', extract: '[12.1.0] (2026-09-21)' }
const DRAFT = 'The latest npm version is 12.1.0 [2].'

/** A full state with the defaults the scenarios do not set. */
function stateWith(over: Partial<ResearchValues>): ResearchValues {
  return {
    question: 'What is the latest version of npm?',
    searchQueries: [],
    messages: [],
    pendingCalls: [],
    toolRounds: 2,
    corroborateAtRound: 0,
    failedLookups: [],
    evidence: [],
    draftText: '',
    draftTruncated: false,
    draftReviewed: false,
    ending: null,
    critique: null,
    revisions: 0,
    route: null,
    finalAnswer: null,
    trace: [],
    ...over,
  }
}

describe('partialResult', () => {
  it('withholds a critic-rejected draft: no_answer with the pages read, answer empty', () => {
    const values = stateWith({
      draftText: DRAFT,
      draftReviewed: true,
      critique: { verdict: 'revise', notes: 'Cite the source that supports this sentence.', reviewed: true },
      revisions: 1,
      evidence: [NPM_PAGE, CHANGELOG],
    })
    const frame = partialResult(values, MS, BUDGET_MESSAGE)
    expect(frame).not.toBeNull()
    expect(frame!.answer).toBe('')
    expect(frame!.ending.kind).toBe('no_answer')
    expect(frame!.ending.message).toContain('critic asked for changes')
    expect(frame!.ending.message).toContain('time limit')
    expect(frame!.sources.map((s) => s.url)).toEqual([NPM_PAGE.url, CHANGELOG.url])
    expect(frame!.answer).not.toContain('12.1.0')
  })

  it('still ships an unreviewed draft as a labelled partial', () => {
    const values = stateWith({ draftText: DRAFT, evidence: [NPM_PAGE, CHANGELOG] })
    const frame = partialResult(values, MS, BUDGET_MESSAGE)
    expect(frame).not.toBeNull()
    expect(frame!.ending.kind).toBe('partial')
    expect(frame!.ending.message).toContain('Unreviewed')
    expect(frame!.answer).toContain('12.1.0')
  })

  it('still ships a revised-but-not-yet-re-reviewed draft (the critique belongs to the previous draft)', () => {
    const values = stateWith({
      draftText: DRAFT,
      revisions: 1,
      critique: { verdict: 'revise', notes: 'Cite the source.', reviewed: true },
      evidence: [CHANGELOG],
    })
    const frame = partialResult(values, MS, BUDGET_MESSAGE)
    expect(frame).not.toBeNull()
    expect(frame!.ending.kind).toBe('partial')
    expect(frame!.ending.message).toContain('Revised once')
    expect(frame!.answer).toContain('12.1.0')
  })

  it('keeps the no-answer ending for a run with no draft, only pages', () => {
    const values = stateWith({ evidence: [NPM_PAGE, CHANGELOG] })
    const frame = partialResult(values, MS, BUDGET_MESSAGE)
    expect(frame).not.toBeNull()
    expect(frame!.answer).toBe('')
    expect(frame!.ending.kind).toBe('no_answer')
    expect(frame!.ending.message).toContain('No answer was written')
    expect(frame!.sources).toHaveLength(2)
  })

  it('returns null when a rejected draft has no pages to show', () => {
    const values = stateWith({
      draftText: DRAFT,
      draftReviewed: true,
      critique: { verdict: 'revise', notes: 'Wrong.', reviewed: true },
      revisions: 1,
    })
    expect(partialResult(values, MS, BUDGET_MESSAGE)).toBeNull()
  })
})
