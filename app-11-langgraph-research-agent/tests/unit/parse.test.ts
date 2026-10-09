import { describe, expect, it, vi } from 'vitest'
import type { Evidence } from '../../netlify/shared/citations'
import { clipText, extractJson, groundedIssues, parseCritic, parseQueries } from '../../netlify/shared/graph/parse'
import { numberSources, runToolCall, type ToolOutcome } from '../../netlify/shared/graph/tools'
import type { ToolCall } from '../../netlify/shared/openrouter'
import { WikiError, type WikiTools } from '../../netlify/shared/wikipedia'

const SIGNAL = new AbortController().signal

const call = (id: string, name: string, args: Record<string, unknown> | string): ToolCall => ({
  id,
  name,
  args: typeof args === 'string' ? args : JSON.stringify(args),
})

describe('extractJson', () => {
  it('reads an object inside a code fence and surrounding prose', () => {
    expect(extractJson('Here you go:\n```json\n{"a": 1}\n```\nThanks.')).toEqual({ a: 1 })
  })

  it('returns undefined when no object parses', () => {
    expect(extractJson('no braces at all')).toBeUndefined()
    expect(extractJson('{ not json }')).toBeUndefined()
  })
})

describe('parseQueries', () => {
  it('collapses spaces, drops repeats and keeps at most three queries', () => {
    const reply = '{"queries": ["Expo  98 Lisbon", "Expo 98 Lisbon", "Lisbon 1998", "Expo \'98 theme", "Fourth one"]}'
    expect(parseQueries(reply)).toEqual(['Expo 98 Lisbon', 'Lisbon 1998', "Expo '98 theme"])
  })

  it('returns nothing for a reply that is not the expected JSON', () => {
    expect(parseQueries('Sure, here are some searches.')).toEqual([])
    expect(parseQueries('{"queries": []}')).toEqual([])
    expect(parseQueries('{"queries": ["   "]}')).toEqual([])
  })
})

describe('parseCritic', () => {
  it('reads an accept verdict with no issues, keeping an old-style note as the summary', () => {
    expect(parseCritic('{"verdict": "accept", "issues": []}')).toEqual({ verdict: 'accept', issues: [], notes: '' })
    expect(parseCritic('{"verdict": "accept", "notes": "Every claim matches source [1]."}')).toEqual({
      verdict: 'accept',
      issues: [],
      notes: 'Every claim matches source [1].',
    })
  })

  it('reads a revise verdict with quoted issues, trimmed, blanks dropped, joined into the notes', () => {
    expect(
      parseCritic(
        '{"checks": [{"claim": "gap", "ok": false}], "verdict": "revise", "issues": [{"quote": "  45 years ", "fix": " Say 42. "}, {}, "Cite [2]."]}',
      ),
    ).toEqual({
      verdict: 'revise',
      issues: [
        { quote: '45 years', fix: 'Say 42.' },
        { quote: '', fix: 'Cite [2].' },
      ],
      notes: '"45 years": Say 42. Cite [2].',
    })
  })

  it('reads a revise verdict that names no issue, so the graph can decline to act on it', () => {
    expect(parseCritic('{"verdict": "revise"}')).toEqual({ verdict: 'revise', issues: [], notes: '' })
    expect(parseCritic('{"verdict": "revise", "issues": ["  "]}')?.issues).toEqual([])
  })

  it('keeps at most five issues', () => {
    const issues = Array.from({ length: 8 }, (_, i) => ({ quote: `Quote ${i + 1}`, fix: 'Fix.' }))
    expect(parseCritic(JSON.stringify({ verdict: 'revise', issues }))?.issues).toEqual(issues.slice(0, 5))
  })

  it('cuts long notes at a word boundary with an ellipsis, never in the middle of a word', () => {
    const verdict = parseCritic(JSON.stringify({ verdict: 'revise', issues: [{ quote: 'q', fix: `${'alpha beta gamma '.repeat(60)}` }] }))
    expect(verdict?.notes.length).toBeLessThanOrEqual(601)
    expect(verdict?.notes.endsWith('gamma…') || verdict?.notes.endsWith('beta…') || verdict?.notes.endsWith('alpha…')).toBe(true)
  })

  it('returns null for an unknown verdict or a reply that is not JSON', () => {
    expect(parseCritic('{"verdict": "maybe", "notes": ""}')).toBeNull()
    expect(parseCritic('Looks good to me.')).toBeNull()
  })
})

const WIKI: WikiTools = {
  search: async (query) => [{ title: 'Expo 98', snippet: `hit for ${query}` }],
  page: async (title) => {
    if (title === 'Expo 98') {
      return { title: 'Expo 98', url: 'https://en.wikipedia.org/wiki/Expo_98', extract: 'Held in 1998.' }
    }
    throw new WikiError(404, `No Wikipedia page has the title "${title}".`)
  },
}

describe('runToolCall', () => {
  it('reads a page and hands it back for numbering', async () => {
    const outcome = await runToolCall(call('c1', 'wikipedia_page', { title: 'Expo 98' }), WIKI, SIGNAL)
    expect(outcome).toMatchObject({ ok: true, note: 'Read "Expo 98".', page: { title: 'Expo 98' } })
  })

  it('searches and returns numbered titles, without reading a page', async () => {
    const outcome = await runToolCall(call('c2', 'wikipedia_search', { query: 'Lisbon' }), WIKI, SIGNAL)
    expect(outcome).toMatchObject({
      ok: true,
      content: '1. Expo 98: hit for Lisbon',
      note: 'Search "Lisbon" returned 1 title(s).',
    })
    expect(outcome.page).toBeUndefined()
  })

  it('refuses arguments that are not JSON and never calls Wikipedia', async () => {
    const wiki = { search: vi.fn(async () => []), page: vi.fn(async () => WIKI.page('Expo 98', SIGNAL)) }
    const outcome = await runToolCall(call('c3', 'wikipedia_page', '{"title":'), wiki, SIGNAL)
    expect(outcome).toMatchObject({ ok: false, content: 'Invalid arguments: send a JSON object.' })
    expect(wiki.page).not.toHaveBeenCalled()
  })

  it('refuses a search with a blank query and a page call with no title, in plain words', async () => {
    const blank = await runToolCall(call('c4', 'wikipedia_search', { query: '   ' }), WIKI, SIGNAL)
    expect(blank.content).toBe('Invalid arguments: wikipedia_search needs a query of 1 to 120 characters.')
    const untitled = await runToolCall(call('c5', 'wikipedia_page', {}), WIKI, SIGNAL)
    expect(untitled.content).toBe('Invalid arguments: wikipedia_page needs a title.')
  })

  it('turns a failed lookup into a plain note with no page', async () => {
    const outcome = await runToolCall(call('c6', 'wikipedia_page', { title: 'Nope' }), WIKI, SIGNAL)
    expect(outcome).toEqual({
      call: call('c6', 'wikipedia_page', { title: 'Nope' }),
      ok: false,
      content: 'No Wikipedia page has the title "Nope".',
      note: 'No Wikipedia page has the title "Nope".',
    })
  })

  it('hides an unexpected error behind a generic lookup message', async () => {
    const broken: WikiTools = {
      search: async () => {
        throw new Error('socket hang up with internal detail')
      },
      page: WIKI.page,
    }
    const outcome = await runToolCall(call('c7', 'wikipedia_search', { query: 'Lisbon' }), broken, SIGNAL)
    expect(outcome.content).toBe('The Wikipedia lookup failed.')
  })

  it('answers an unknown tool name plainly', async () => {
    const outcome = await runToolCall(call('c8', 'wikipedia_fetch', { url: 'x' }), WIKI, SIGNAL)
    expect(outcome.content).toBe('Unknown tool. Use wikipedia_search or wikipedia_page.')
  })
})

const pageOutcome = (id: string, title: string, url: string): ToolOutcome => ({
  call: call(id, 'wikipedia_page', { title }),
  ok: true,
  content: '',
  note: `Read "${title}".`,
  page: { title, url, extract: `${title} text` },
})

describe('numberSources', () => {
  it('numbers new pages in call order, after the sources already held', () => {
    const existing: Evidence[] = [{ n: 1, title: 'Expo 98', url: 'u-expo', extract: 'x' }]
    const batch = numberSources(
      [pageOutcome('a', 'Lisbon', 'u-lisbon'), pageOutcome('b', 'Portugal', 'u-portugal')],
      existing,
    )
    expect(batch.added.map((item) => [item.n, item.title])).toEqual([
      [2, 'Lisbon'],
      [3, 'Portugal'],
    ])
    expect(batch.messages).toEqual([
      { role: 'tool', tool_call_id: 'a', content: 'Source [2]: Lisbon\nu-lisbon\n\nLisbon text' },
      { role: 'tool', tool_call_id: 'b', content: 'Source [3]: Portugal\nu-portugal\n\nPortugal text' },
    ])
  })

  it('keeps the number of a page already held and adds no source for it', () => {
    const existing: Evidence[] = [{ n: 1, title: 'Expo 98', url: 'u-expo', extract: 'x' }]
    const batch = numberSources([pageOutcome('a', 'Expo 98', 'u-expo')], existing)
    expect(batch.added).toEqual([])
    expect(batch.messages).toEqual([
      { role: 'tool', tool_call_id: 'a', content: 'Already have this page as source [1].' },
    ])
  })

  it('numbers a page once when two calls in one batch read it', () => {
    const batch = numberSources([pageOutcome('a', 'Lisbon', 'u-lisbon'), pageOutcome('b', 'Lisbon', 'u-lisbon')], [])
    expect(batch.added.map((item) => item.n)).toEqual([1])
    expect(batch.messages.map((message) => message.content)).toEqual([
      'Source [1]: Lisbon\nu-lisbon\n\nLisbon text',
      'Already have this page as source [1].',
    ])
  })

  it('answers every call, including the failed ones, with a tool message', () => {
    const failed: ToolOutcome = {
      call: call('x', 'wikipedia_page', { title: 'Nope' }),
      ok: false,
      content: 'No Wikipedia page has the title "Nope".',
      note: 'No Wikipedia page has the title "Nope".',
    }
    const batch = numberSources([failed], [])
    expect(batch.added).toEqual([])
    expect(batch.messages).toEqual([
      { role: 'tool', tool_call_id: 'x', content: 'No Wikipedia page has the title "Nope".' },
    ])
  })
})

describe('clipText', () => {
  it('leaves short text alone', () => {
    expect(clipText('Short note.', 600)).toBe('Short note.')
  })

  it('cuts at the last sentence end when one falls in the second half', () => {
    expect(clipText('First sentence here. Second sentence goes on and on', 30)).toBe('First sentence here.')
  })

  it('cuts at the last space otherwise and adds an ellipsis', () => {
    expect(clipText('one two three four five six seven', 20)).toBe('one two three four…')
  })
})

describe('groundedIssues', () => {
  const issues = [
    { quote: 'The difference is 45 years', fix: 'Say 42.' },
    { quote: 'a claim that is not there', fix: 'Remove it.' },
    { quote: '', fix: 'No quote.' },
    { quote: 'ab', fix: 'Too short to count.' },
  ]

  it('keeps only the issues whose quote is in the draft or the question, ignoring case and spacing', () => {
    expect(groundedIssues(issues, 'The  difference is\n45 YEARS [1][2].', 'Which came first?')).toEqual([issues[0]])
    expect(groundedIssues([{ quote: 'which came first', fix: 'Answer it.' }], 'The draft.', 'Which came first?')).toHaveLength(1)
  })

  it('keeps nothing when no text holds a quote', () => {
    expect(groundedIssues(issues, 'Unrelated text.')).toEqual([])
  })
})
