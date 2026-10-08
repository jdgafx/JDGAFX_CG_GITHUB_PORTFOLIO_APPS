import { describe, expect, it } from 'vitest'
import { EMPTY_MESSAGE, RANGE_MESSAGE } from '../../src/lib/limits'
import {
  allowedOrigins,
  corsHeaders,
  MAX_BODY_BYTES,
  rateLimit,
  readJsonBody,
  validateRunBody,
} from '../../netlify/shared/guard'

describe('validateRunBody', () => {
  it('accepts text of 200 to 20,000 characters', () => {
    expect(validateRunBody({ text: 'a'.repeat(200) })).toEqual({ ok: true, text: 'a'.repeat(200) })
    expect(validateRunBody({ text: 'a'.repeat(20000) }).ok).toBe(true)
  })

  it('refuses text outside the range with a plain 400', () => {
    expect(validateRunBody({ text: 'a'.repeat(199) })).toEqual({ ok: false, status: 400, error: RANGE_MESSAGE })
    expect(validateRunBody({ text: 'a'.repeat(20001) })).toEqual({ ok: false, status: 400, error: RANGE_MESSAGE })
  })

  it('refuses text that is only whitespace, even at the minimum length', () => {
    expect(validateRunBody({ text: ' '.repeat(200) })).toEqual({ ok: false, status: 400, error: EMPTY_MESSAGE })
  })

  it('refuses a body without a text string', () => {
    expect(validateRunBody(null)).toMatchObject({ ok: false, status: 400, error: 'Send a JSON object with a text field.' })
    expect(validateRunBody({ text: 42 })).toMatchObject({ ok: false, status: 400, error: 'The text field must be a string.' })
  })
})

describe('origins and CORS', () => {
  it('allows the live site and local dev servers, plus extra origins from the environment', () => {
    const origins = allowedOrigins('https://example.test, http://127.0.0.1:9000')

    expect(origins).toContain('https://jdgafx-app-13-langgraph-map-reduce.netlify.app')
    expect(origins).toContain('http://localhost:8888')
    expect(origins).toContain('http://localhost:5173')
    expect(origins).toContain('https://example.test')
    expect(origins).toContain('http://127.0.0.1:9000')
  })

  it('echoes only an allowed origin', () => {
    const origins = allowedOrigins(undefined)

    expect(corsHeaders('http://localhost:5173', origins)['Access-Control-Allow-Origin']).toBe('http://localhost:5173')
    expect(corsHeaders('https://evil.test', origins)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})

describe('rateLimit', () => {
  it('allows 20 runs a minute per client and refuses the 21st with a retry time', () => {
    const now = 1_000_000
    const key = 'guard-test-client'
    for (let i = 0; i < 20; i += 1) expect(rateLimit(key, now).allowed).toBe(true)

    const refused = rateLimit(key, now + 5_000)
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfter).toBe(55)
  })
})

describe('readJsonBody', () => {
  it('reads a JSON body', async () => {
    const req = new Request('https://app.test/api/run', { method: 'POST', body: JSON.stringify({ text: 'hi' }) })

    expect(await readJsonBody(req)).toEqual({ ok: true, value: { text: 'hi' } })
  })

  it('refuses a body that is not JSON with a plain 400', async () => {
    const req = new Request('https://app.test/api/run', { method: 'POST', body: '{not json' })

    expect(await readJsonBody(req)).toEqual({ ok: false, status: 400, error: 'Request body was not valid JSON.' })
  })

  it('refuses a body over the byte cap with a 413, whatever its declared length', async () => {
    const big = JSON.stringify({ text: 'a'.repeat(MAX_BODY_BYTES + 1) })
    const req = new Request('https://app.test/api/run', { method: 'POST', body: big })

    expect(await readJsonBody(req)).toEqual({ ok: false, status: 413, error: 'Request is too large.' })
  })
})
