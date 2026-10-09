import { afterEach, describe, expect, it, vi } from 'vitest'
import { gate, readJson, REQUEST_BUDGET_MS, remainingMs } from '../../netlify/shared/guard'

const URL_POST = 'http://localhost:8888/api/compare'
const ORIGIN = 'http://localhost:5173'
const TOO_LARGE = 'The request is too large. Shorten the prompt and try again.'

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(URL_POST, { method: 'POST', headers: { origin: ORIGIN, ...headers }, body })
}

describe('readJson', () => {
  it('parses a JSON body under the limit', async () => {
    expect(await readJson(post('{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } })
  })

  it('rejects a body that is not JSON with a plain message', async () => {
    expect(await readJson(post('{"a":'), 100)).toEqual({ ok: false, error: 'The request body must be JSON' })
  })

  it('refuses a declared length over the limit', async () => {
    expect(await readJson(post('{"a":1}', { 'content-length': '5000' }), 100)).toEqual({ ok: false, error: TOO_LARGE })
  })

  it('refuses a measured body over the limit', async () => {
    expect(await readJson(post('x'.repeat(200)), 100)).toEqual({ ok: false, error: TOO_LARGE })
  })

  it('counts UTF-8 bytes, so 60 accented letters (122 bytes as JSON) are refused at a limit of 100', async () => {
    expect(await readJson(post(JSON.stringify('é'.repeat(60))), 100)).toEqual({ ok: false, error: TOO_LARGE })
  })

  it('accepts a body of exactly the limit', async () => {
    const body = JSON.stringify('x'.repeat(98))
    expect(body.length).toBe(100)
    expect(await readJson(post(body), 100)).toEqual({ ok: true, value: 'x'.repeat(98) })
  })
})

describe('gate', () => {
  it('answers a GET on a POST endpoint with 405', async () => {
    const result = gate(new Request(URL_POST, { method: 'GET', headers: { origin: ORIGIN } }), 'POST')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(405)
    expect(await result.response.json()).toEqual({ error: 'Method not allowed' })
  })

  it('refuses an origin that is not on the allowlist with 403', async () => {
    const result = gate(new Request(URL_POST, { method: 'POST', headers: { origin: 'https://evil.example' } }), 'POST')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
    expect(await result.response.json()).toEqual({ error: 'Origin not allowed' })
  })

  it('answers a preflight with 204 and echoes the allowed origin', () => {
    const result = gate(new Request(URL_POST, { method: 'OPTIONS', headers: { origin: ORIGIN } }), 'POST')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(204)
    expect(result.response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  })

  it('passes a request with no origin, such as a server-side call', () => {
    const result = gate(new Request(URL_POST, { method: 'POST' }), 'POST')
    expect(result.ok).toBe(true)
  })

  describe('rate limit', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    it('answers 429 once a client passes RATE_LIMIT_MAX POSTs in the window', async () => {
      vi.stubEnv('RATE_LIMIT_MAX', '2')
      vi.resetModules()
      const fresh = await import('../../netlify/shared/guard')
      const headers = { origin: ORIGIN, 'x-nf-client-connection-ip': '203.0.113.7' }
      const results = [1, 2, 3].map(() => fresh.gate(new Request(URL_POST, { method: 'POST', headers }), 'POST'))
      expect(results.map(r => r.ok)).toEqual([true, true, false])
      const refused = results[2]
      expect(refused.ok).toBe(false)
      if (refused.ok) return
      expect(refused.response.status).toBe(429)
      expect(await refused.response.json()).toEqual({ error: 'Too many requests. Wait a minute and try again.' })
    })
  })
})

describe('remainingMs', () => {
  it('leaves the 24 second request budget less the time already used', () => {
    expect(REQUEST_BUDGET_MS).toBe(24_000)
    const left = remainingMs(Date.now() - 10_000)
    expect(left).toBeGreaterThan(13_900)
    expect(left).toBeLessThanOrEqual(14_000)
  })

  it('never goes below zero once the budget is spent', () => {
    expect(remainingMs(Date.now() - 60_000)).toBe(0)
  })
})
