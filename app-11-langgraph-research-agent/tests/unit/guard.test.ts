import { describe, expect, it } from 'vitest'
import {
  allowedOrigins,
  clientKey,
  corsHeaders,
  createRateLimiter,
  originAllowed,
  readJsonBody,
  validateQuestion,
} from '../../netlify/shared/guard'

const DEFAULTS = [
  'https://jdgafx-app-11-langgraph-research-agent.netlify.app',
  'http://localhost:8888',
  'http://localhost:5173',
]

const postJson = (body: string): Request =>
  new Request('https://example.test/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

describe('origins', () => {
  it('allows the live address and the two local dev servers by default', () => {
    expect(allowedOrigins(undefined)).toEqual(DEFAULTS)
  })

  it('adds ALLOWED_ORIGINS entries, trimmed, with blanks ignored', () => {
    expect(allowedOrigins(' https://example.test , ,http://localhost:3000')).toEqual([
      ...DEFAULTS,
      'https://example.test',
      'http://localhost:3000',
    ])
  })

  it('lets a request with no Origin through and refuses an origin that is not listed', () => {
    expect(originAllowed(null, DEFAULTS)).toBe(true)
    expect(originAllowed('https://evil.example', DEFAULTS)).toBe(false)
    expect(originAllowed('http://localhost:5173', DEFAULTS)).toBe(true)
  })

  it('echoes only an allowed origin in the CORS header', () => {
    expect(corsHeaders('http://localhost:5173', DEFAULTS)['Access-Control-Allow-Origin']).toBe('http://localhost:5173')
    expect(corsHeaders('https://evil.example', DEFAULTS)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})

describe('rate limit', () => {
  it('allows 20 calls a minute and refuses the 21st with the seconds until the window resets', () => {
    const limiter = createRateLimiter()
    for (let i = 0; i < 20; i += 1) expect(limiter.check('client-a', 1_000).allowed).toBe(true)
    expect(limiter.check('client-a', 1_000)).toEqual({ allowed: false, retryAfterSec: 60 })
  })

  it('opens a fresh window once the minute has passed', () => {
    const limiter = createRateLimiter()
    for (let i = 0; i < 21; i += 1) limiter.check('client-b', 1_000)
    expect(limiter.check('client-b', 61_001)).toEqual({ allowed: true, retryAfterSec: 0 })
  })

  it('counts each client on its own', () => {
    const limiter = createRateLimiter(1, 60_000)
    expect(limiter.check('one', 0).allowed).toBe(true)
    expect(limiter.check('one', 0).allowed).toBe(false)
    expect(limiter.check('two', 0).allowed).toBe(true)
  })
})

describe('clientKey', () => {
  it('prefers the Netlify client address, then the first forwarded address, then a fallback', () => {
    const withNetlify = new Request('https://example.test', {
      headers: { 'x-nf-client-connection-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' },
    })
    const forwarded = new Request('https://example.test', { headers: { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' } })
    expect(clientKey(withNetlify)).toBe('203.0.113.7')
    expect(clientKey(forwarded)).toBe('198.51.100.1')
    expect(clientKey(new Request('https://example.test'))).toBe('unknown')
  })
})

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    expect(await readJsonBody(postJson('{"question":"Hi"}'))).toEqual({ ok: true, value: { question: 'Hi' } })
  })

  it('refuses a body larger than the cap, with 413', async () => {
    const result = await readJsonBody(postJson(`{"question":"${'x'.repeat(200)}"}`), 100)
    expect(result).toEqual({ ok: false, status: 413, message: 'The request is too large.' })
  })

  it('refuses a small body that declares a larger Content-Length, with 413', async () => {
    const declared = new Request('https://example.test/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '999999' },
      body: '{"question":"Hi"}',
    })
    expect(await readJsonBody(declared, 100)).toEqual({ ok: false, status: 413, message: 'The request is too large.' })
  })

  it('refuses a body that is not JSON, with 400 and a plain message', async () => {
    expect(await readJsonBody(postJson('{"question":'))).toEqual({
      ok: false,
      status: 400,
      message: 'The request body must be JSON.',
    })
  })

  it('refuses a request with no body, with 400', async () => {
    const empty = new Request('https://example.test/api/run', { method: 'POST' })
    expect(await readJsonBody(empty)).toMatchObject({ ok: false, status: 400 })
  })
})

describe('validateQuestion', () => {
  it('trims the question and accepts it', () => {
    expect(validateQuestion({ question: '  What is Lisbon?  ' })).toEqual({ ok: true, question: 'What is Lisbon?' })
  })

  it('refuses an empty or blank question with the length message', () => {
    const message = 'The question must be 1 to 500 characters.'
    expect(validateQuestion({ question: '' })).toEqual({ ok: false, message })
    expect(validateQuestion({ question: '   ' })).toEqual({ ok: false, message })
  })

  it('accepts exactly 500 characters and refuses 501', () => {
    expect(validateQuestion({ question: 'x'.repeat(500) }).ok).toBe(true)
    expect(validateQuestion({ question: 'x'.repeat(501) }).ok).toBe(false)
  })

  it('counts characters, not UTF-16 units', () => {
    expect(validateQuestion({ question: '\u{1F642}'.repeat(500) }).ok).toBe(true)
  })

  it('refuses a body without a text question field', () => {
    const message = 'The request needs a question field with text.'
    expect(validateQuestion({})).toEqual({ ok: false, message })
    expect(validateQuestion({ question: 42 })).toEqual({ ok: false, message })
    expect(validateQuestion('just a string')).toEqual({ ok: false, message })
  })
})
