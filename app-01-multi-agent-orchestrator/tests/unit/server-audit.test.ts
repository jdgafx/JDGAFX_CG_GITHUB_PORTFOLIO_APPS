import { describe, expect, it } from 'vitest'
import { RequestError } from '../../netlify/shared/gate'
import { AUDIT_AGENT, AUDIT_BUDGET_MS, auditMessage, parseJudgments, readAuditRequest } from '../../netlify/shared/audit'
import { extractClaims } from '../../src/lib/audit'

function post(body: unknown): Request {
  return new Request('https://site.example/.netlify/functions/audit', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
}

const SOURCE = { n: 1, title: 'T', site: 'Wikipedia', snippet: 'Text of the source.' }

const C = { kind: 'source_claim', source_supports: 'yes', subject_matches: 'yes', cause_matches: 'not_applicable', all_parts_covered: 'yes' }
const J = { kind: 'source_claim', sourceSupports: 'yes', subjectMatches: 'yes', causeMatches: 'not_applicable', allPartsCovered: 'yes' }

describe('parseJudgments', () => {
  it('reads the typed criteria and spans, in any order, and ignores a duplicate id', () => {
    const text = JSON.stringify({
      results: [
        { id: 2, ...C, all_parts_covered: 'no', spans: [{ source: 1, text: 'q two' }], uncovered: 'the date', reason: 'r' },
        { id: 1, ...C, cause_matches: 'yes', spans: [{ source: 2, text: 'q one' }, { source: 2, text: 'q one b' }] },
        { id: 1, ...C, source_supports: 'no' },
      ],
    })
    expect(parseJudgments(text)).toEqual([
      { id: 2, ...J, allPartsCovered: 'no', spans: [{ source: 1, text: 'q two' }], uncovered: 'the date', reason: 'r' },
      { id: 1, ...J, causeMatches: 'yes', spans: [{ source: 2, text: 'q one' }, { source: 2, text: 'q one b' }] },
    ])
  })

  it('ignores a verdict field the model sends, and drops an entry with a missing or invalid criterion', () => {
    const text = JSON.stringify({
      results: [
        { id: 1, ...C, verdict: 'unsupported' },
        { id: 2, ...C, subject_matches: 'maybe' },
        { id: 3, source_supports: 'yes', subject_matches: 'yes', all_parts_covered: 'yes' },
        { id: 4, ...C, cause_matches: 'n/a' },
      ],
    })
    expect(parseJudgments(text)).toEqual([{ id: 1, ...J }])
  })

  it('counts a malformed span instead of hiding it', () => {
    const fenced = '```json\n' + JSON.stringify({ results: [{ id: 1, ...C, spans: [{ source: 1, text: 'a b c' }, { source: 'x', text: 'd' }, 'e', { source: 2 }] }] }) + '\n```'
    expect(parseJudgments(fenced)).toEqual([{ id: 1, ...J, spans: [{ source: 1, text: 'a b c' }], badSpans: 3 }])
  })

  it('reads kind about_research without the four answers, and drops an entry with no valid kind', () => {
    const text = JSON.stringify({ results: [{ id: 1, kind: 'about_research', reason: 'About the evidence.' }, { id: 2, ...C, kind: 'maybe' }, { id: 3, source_supports: 'yes', subject_matches: 'yes', cause_matches: 'yes', all_parts_covered: 'yes' }] })
    expect(parseJudgments(text)).toEqual([{ id: 1, kind: 'about_research', sourceSupports: 'yes', subjectMatches: 'yes', causeMatches: 'not_applicable', allPartsCovered: 'yes', reason: 'About the evidence.' }])
  })

  it('reads non-JSON as nothing', () => {
    expect(parseJudgments('I cannot help with that.')).toEqual([])
  })

  it('reads nothing from a reply that stops mid-list: a cut-off list is never partly used', () => {
    const cut = JSON.stringify({ results: [{ id: 1, ...C }] }).slice(0, -5)
    expect(parseJudgments(cut)).toEqual([])
  })
})

describe('auditMessage', () => {
  it('lists the sources by number and the claims by id, each with the sentence before it in the same block as read-only context', () => {
    const claims = extractClaims('Webb saw galaxies [1]. It is large [2].\n\nIt has a mirror [2].')
    const message = auditMessage(claims, [
      { n: 1, title: 'JWST', site: 'Wikipedia', url: '', snippet: 'Webb text.' },
      { n: 2, title: 'Story', site: 'Hacker News', url: '', snippet: 'Story text.' },
    ])
    expect(message).toBe(
      'Sources:\n[1] JWST (Wikipedia): Webb text.\n[2] Story (Hacker News): Story text.\n\n' +
        'Claims (judge each claim only; its Context is the sentence before it in the report, shown so words such as "These" can be understood, and is never judged):\n' +
        '1. Webb saw galaxies [1].\n' +
        '2. It is large [2].\n   Context: Webb saw galaxies.\n' +
        '3. It has a mirror [2].',
    )
  })
})

describe('readAuditRequest', () => {
  it('accepts a report with numbered sources and caps their text', async () => {
    const request = await readAuditRequest(post({ report: ' Fact [1]. ', sources: [{ ...SOURCE, snippet: 'x'.repeat(900) }] }))
    expect(request.report).toBe('Fact [1].')
    expect(request.sources[0]?.snippet).toHaveLength(501)
  })

  it.each([
    ['not JSON', 'nope', 'Invalid JSON.'],
    ['no report', { sources: [] }, 'Missing report.'],
    ['blank report', { report: '  ', sources: [] }, 'Missing report.'],
    ['no sources list', { report: 'x [1]' }, 'Missing sources.'],
    ['too many sources', { report: 'x', sources: Array.from({ length: 9 }, (_, i) => ({ ...SOURCE, n: i + 1 })) }, 'Too many sources: 8 at most.'],
    ['sources not numbered from 1', { report: 'x', sources: [{ ...SOURCE, n: 2 }] }, 'Sources must be numbered from 1, each with a title and text.'],
    ['a long report', { report: 'x'.repeat(8001), sources: [] }, 'Report too long: 8000 characters at most.'],
  ])('refuses %s with a plain message', async (_name, body, message) => {
    const failure = await readAuditRequest(post(body)).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(RequestError)
    expect((failure as RequestError).message).toBe(message)
    expect((failure as RequestError).status).toBe(400)
  })
})

describe('audit call budget', () => {
  it('leaves room for thinking plus the JSON, and its request limit stays under the 30 s cut-off', () => {
    // 20 claims: about 170 visible tokens each from the live run, plus thinking that was 1,231 of 1,898 tokens for 4 claims.
    expect(AUDIT_AGENT.maxTokens).toBeGreaterThanOrEqual(5_500)
    // The attempt may use up to 25 s, so a long reply is not cut by the timer before max_tokens; the budget and 30 s limit still hold.
    expect(AUDIT_AGENT.timeoutMs).toBeGreaterThanOrEqual(25_000)
    expect(AUDIT_AGENT.timeoutMs).toBeLessThan(AUDIT_BUDGET_MS)
    expect(AUDIT_BUDGET_MS + 2_000).toBeLessThan(30_000)
  })
})

describe('audit prompt', () => {
  it('states the scope rule: a claim must cover what the source covers, in both directions, with a worked example', () => {
    const prompt = AUDIT_AGENT.systemPrompt
    expect(prompt).toContain('Scope rule')
    expect(prompt).toContain('narrower than the source')
    expect(prompt).toContain('wider than the source')
    expect(prompt).toContain('Example of a scope shift')
  })

  it('asks for typed criteria and no verdict: the exact source spans, and the part of the claim the source does not cover', () => {
    const prompt = AUDIT_AGENT.systemPrompt
    expect(prompt).toContain('"spans"')
    expect(prompt).toContain('"uncovered"')
    expect(prompt).toContain('about_research')
    for (const field of ['source_supports', 'subject_matches', 'cause_matches', 'all_parts_covered']) expect(prompt).toContain(field)
    expect(prompt).not.toContain('"verdict"')
    // Each question is answered once: a different cause is cause_matches only, never a reason for source_supports to say no.
    const supports = prompt.slice(prompt.indexOf('"source_supports":'), prompt.indexOf('"subject_matches"'))
    expect(supports).toContain('answered under cause_matches only')
    expect(supports).not.toMatch(/reversed order, direction, cause/)
    expect(prompt).toContain('Context')
    expect(prompt).not.toContain('conflict')
  })
})
