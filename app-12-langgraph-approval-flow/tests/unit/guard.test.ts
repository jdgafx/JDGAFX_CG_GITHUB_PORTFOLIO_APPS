import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_BODY_BYTES,
  allowedOrigins,
  checkRequest,
  decisionFrom,
  rateLimit,
  readJsonBody,
  threadIdFrom,
  ticketFrom,
} from '../../netlify/shared/guard'
import { NOTE_MAX_LENGTH, TICKET_MAX_LENGTH, TICKET_MIN_LENGTH, ticketProblem } from '../../src/lib/limits'

const LIVE = 'https://jdgafx-app-12-langgraph-approval-flow.netlify.app'

afterEach(() => {
  delete process.env.ALLOWED_ORIGINS
})

describe('origins', () => {
  it('allows the live site and local dev, and adds ALLOWED_ORIGINS from the environment', () => {
    process.env.ALLOWED_ORIGINS = 'https://preview.example.test, https://other.example.test'
    expect(allowedOrigins()).toEqual([
      LIVE,
      'http://localhost:8888',
      'http://localhost:5173',
      'https://preview.example.test',
      'https://other.example.test',
    ])
  })

  it('refuses a request from an unknown origin with 403, and wrong methods with 405', () => {
    const foreign = new Request('https://x.test/api/start', {
      method: 'POST',
      headers: { origin: 'https://evil.example.test' },
    })
    expect(checkRequest(foreign, 'POST')?.status).toBe(403)

    const wrongMethod = new Request('https://x.test/api/start', { method: 'GET' })
    const refused = checkRequest(wrongMethod, 'POST')
    expect(refused?.status).toBe(405)
    expect(refused?.headers.get('Allow')).toBe('POST')
  })

  it('lets an allowed origin and a request without an origin through', () => {
    expect(checkRequest(new Request('https://x.test/api/threads', { headers: { origin: LIVE } }), 'GET')).toBeNull()
    expect(checkRequest(new Request('https://x.test/api/threads'), 'GET')).toBeNull()
  })
})

describe('readJsonBody', () => {
  it('reads valid JSON', async () => {
    const result = await readJsonBody(new Request('https://x.test', { method: 'POST', body: '{"ticket":"hi"}' }))
    expect(result).toEqual({ ok: true, value: { ticket: 'hi' } })
  })

  it('refuses a body whose declared length is over the cap, before reading it', async () => {
    const request = new Request('https://x.test', {
      method: 'POST',
      body: '{}',
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
    })
    const result = await readJsonBody(request)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(413)
  })

  it('refuses a body whose measured length is over the cap, even with no declared length', async () => {
    const big = 'x'.repeat(MAX_BODY_BYTES + 10)
    const result = await readJsonBody(new Request('https://x.test', { method: 'POST', body: big }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(413)
  })

  it('answers 400 with a plain message when the body is not JSON', async () => {
    const result = await readJsonBody(new Request('https://x.test', { method: 'POST', body: '{nope' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
      expect(await result.response.json()).toEqual({ success: false, error: 'Request body was not valid JSON.' })
    }
  })
})

describe('ticket limits', () => {
  it('accepts 10 to 2,000 characters after trimming, and refuses anything outside that range', () => {
    expect(TICKET_MIN_LENGTH).toBe(10)
    expect(TICKET_MAX_LENGTH).toBe(2000)
    expect(ticketProblem('x'.repeat(9))).toBe('The ticket must be 10 to 2,000 characters.')
    expect(ticketProblem('  ' + 'x'.repeat(10) + '  ')).toBeNull()
    expect(ticketProblem('x'.repeat(2000))).toBeNull()
    expect(ticketProblem('x'.repeat(2001))).toBe('The ticket must be 10 to 2,000 characters.')
  })

  it('returns the trimmed ticket for a valid body and the plain rule for anything else', () => {
    expect(ticketFrom({ ticket: '  Order ORD-1077 is damaged.  ' })).toEqual({
      ok: true,
      value: 'Order ORD-1077 is damaged.',
    })
    expect(ticketFrom({ ticket: 42 })).toEqual({ ok: false, message: 'The ticket must be 10 to 2,000 characters.' })
    expect(ticketFrom(null)).toEqual({ ok: false, message: 'The ticket must be 10 to 2,000 characters.' })
  })
})

describe('thread ids', () => {
  it('accepts a generated id and refuses anything that could be a path', () => {
    expect(threadIdFrom('3f2b6c1e-9a4d-4e8f-8b7a-1c2d3e4f5a6b')).toBe('3f2b6c1e-9a4d-4e8f-8b7a-1c2d3e4f5a6b')
    expect(threadIdFrom('../thread/other')).toBeNull()
    expect(threadIdFrom(null)).toBeNull()
  })
})

describe('decisionFrom', () => {
  it('accepts approve and reject, and drops an amount sent with them', () => {
    expect(decisionFrom({ decision: { action: 'approve', amount: 5 } })).toEqual({ ok: true, value: { action: 'approve' } })
    expect(decisionFrom({ decision: { action: 'reject', note: '  Bank hold  ' } })).toEqual({
      ok: true,
      value: { action: 'reject', note: 'Bank hold' },
    })
  })

  it('needs a positive amount with at most two decimals for an edit', () => {
    expect(decisionFrom({ decision: { action: 'edit', amount: 100 } })).toEqual({
      ok: true,
      value: { action: 'edit', amount: 100 },
    })
    const message = 'Enter an amount greater than zero, with at most two decimals.'
    expect(decisionFrom({ decision: { action: 'edit' } })).toEqual({ ok: false, message })
    expect(decisionFrom({ decision: { action: 'edit', amount: 0 } })).toEqual({ ok: false, message })
    expect(decisionFrom({ decision: { action: 'edit', amount: 1.005 } })).toEqual({ ok: false, message })
    expect(decisionFrom({ decision: { action: 'edit', amount: '12' } })).toEqual({ ok: false, message })
    expect(decisionFrom({ decision: { action: 'edit', amount: 12.5 } })).toEqual({
      ok: true,
      value: { action: 'edit', amount: 12.5 },
    })
  })

  it('refuses an unknown action and an over-long note with plain messages', () => {
    expect(decisionFrom({ decision: { action: 'delete' } })).toEqual({
      ok: false,
      message: 'Choose approve, edit or reject.',
    })
    expect(decisionFrom({ decision: { action: 'approve', note: 'x'.repeat(NOTE_MAX_LENGTH + 1) } })).toEqual({
      ok: false,
      message: `The note must be ${NOTE_MAX_LENGTH} characters or fewer.`,
    })
  })
})

describe('rateLimit', () => {
  it('allows 20 requests a minute per key, then refuses until the window passes', () => {
    const key = 'client-under-test'
    const start = 1_000_000
    for (let i = 0; i < 20; i += 1) expect(rateLimit(key, start).allowed).toBe(true)
    const refused = rateLimit(key, start)
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfter).toBe(60)
    expect(rateLimit(key, start + 60_000).allowed).toBe(true)
  })
})
