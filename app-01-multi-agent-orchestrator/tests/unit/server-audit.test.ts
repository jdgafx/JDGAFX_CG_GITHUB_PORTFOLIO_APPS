import { describe, expect, it } from 'vitest'
import { RequestError } from '../../netlify/shared/gate'
import { AUDIT_AGENT, AUDIT_BUDGET_MS, auditMessage, parseJudgments, readAuditRequest } from '../../netlify/shared/audit'
import { extractClaims } from '../../src/lib/audit'

function post(body: unknown): Request {
  return new Request('https://site.example/.netlify/functions/audit', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
}

const SOURCE = { n: 1, title: 'T', site: 'Wikipedia', snippet: 'Text of the source.' }

describe('parseJudgments', () => {
  it('reads the typed entries, in any order, and ignores a duplicate id', () => {
    const text =
      '{"results":[{"id":2,"verdict":"partly","spans":[{"source":1,"text":"q two"}],"uncovered":"the date","reason":"r"},{"id":1,"verdict":"supported","spans":[{"source":2,"text":"q one"},{"source":2,"text":"q one b"}]},{"id":1,"verdict":"unsupported"}]}'
    expect(parseJudgments(text)).toEqual([
      { id: 2, verdict: 'partly', spans: [{ source: 1, text: 'q two' }], uncovered: 'the date', reason: 'r' },
      { id: 1, verdict: 'supported', spans: [{ source: 2, text: 'q one' }, { source: 2, text: 'q one b' }] },
    ])
  })

  it('reads a reply wrapped in a code fence, drops unknown verdicts and malformed spans, and reads non-JSON as nothing', () => {
    const fenced = '```json\n{"results":[{"id":1,"verdict":"supported","spans":[{"source":1,"text":"a b c"},{"source":"x","text":"d"},"e"]},{"id":2,"verdict":"great"}]}\n```'
    expect(parseJudgments(fenced)).toEqual([{ id: 1, verdict: 'supported', spans: [{ source: 1, text: 'a b c' }] }])
    expect(parseJudgments('I cannot help with that.')).toEqual([])
  })

  it('reads nothing from a reply that stops mid-list: a cut-off list is never partly used', () => {
    const cut = '{"results":[{"id":1,"verdict":"supported","spans":[{"source":1,"text":"a b c"}]},{"id":2,"verdict":"unsupported","reason":"no'
    expect(parseJudgments(cut)).toEqual([])
  })
})

describe('auditMessage', () => {
  it('lists the sources by number and the claims by id, each with the sentence before it as read-only context', () => {
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
        '3. It has a mirror [2].\n   Context: It is large.',
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

  it('asks for typed output: a verdict, the exact source spans, and the part of the claim the source does not cover', () => {
    const prompt = AUDIT_AGENT.systemPrompt
    expect(prompt).toContain('"spans"')
    expect(prompt).toContain('"uncovered"')
    expect(prompt).toContain('Context')
    expect(prompt).not.toContain('conflict')
  })
})
