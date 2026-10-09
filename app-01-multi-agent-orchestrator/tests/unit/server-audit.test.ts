import { describe, expect, it } from 'vitest'
import { RequestError } from '../../netlify/shared/gate'
import { auditMessage, parseJudgments, readAuditRequest } from '../../netlify/shared/audit'
import { extractClaims } from '../../src/lib/audit'

function post(body: unknown): Request {
  return new Request('https://site.example/.netlify/functions/audit', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
}

const SOURCE = { n: 1, title: 'T', site: 'Wikipedia', snippet: 'Text of the source.' }

describe('parseJudgments', () => {
  it('reads every complete entry, in any order, and ignores a duplicate id', () => {
    const text = '{"results":[{"id":2,"verdict":"partly","source":1,"quote":"q two","reason":"r"},{"id":1,"verdict":"supported","source":1,"quote":"q one"},{"id":1,"verdict":"unsupported"}]}'
    expect(parseJudgments(text)).toEqual([
      { id: 2, verdict: 'partly', source: 1, quote: 'q two', reason: 'r' },
      { id: 1, verdict: 'supported', source: 1, quote: 'q one' },
    ])
  })

  it('keeps the entries before a cut-off tail, and drops unknown verdicts and non-JSON', () => {
    const cut = '```json\n{"results":[{"id":1,"verdict":"supported","quote":"a b c"},{"id":2,"verdict":"great"},{"id":3,"verdict":"unsupported","reason":"no'
    expect(parseJudgments(cut)).toEqual([{ id: 1, verdict: 'supported', quote: 'a b c' }])
    expect(parseJudgments('I cannot help with that.')).toEqual([])
  })
})

describe('auditMessage', () => {
  it('lists the sources by number and the claims by id, so the verdicts can be matched back', () => {
    const claims = extractClaims('Webb saw galaxies [1].\n\nIt is large [2].')
    const message = auditMessage(claims, [
      { n: 1, title: 'JWST', site: 'Wikipedia', url: '', snippet: 'Webb text.' },
      { n: 2, title: 'Story', site: 'Hacker News', url: '', snippet: 'Story text.' },
    ])
    expect(message).toBe('Sources:\n[1] JWST (Wikipedia): Webb text.\n[2] Story (Hacker News): Story text.\n\nClaims:\n1. Webb saw galaxies [1].\n2. It is large [2].')
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
