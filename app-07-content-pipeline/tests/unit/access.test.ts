import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientKey, corsHeaders, originAllowed, rateLimited } from '../../netlify/shared/access'
import { SITE_URL } from '../../netlify/shared/provider'

afterEach(() => {
  vi.useRealTimers()
})

describe('originAllowed', () => {
  it('accepts a request with no Origin header, which is not cross-site browser traffic', () => {
    expect(originAllowed(null)).toBe(true)
  })

  it('accepts the site and the local dev servers, with or without a trailing slash', () => {
    expect(originAllowed(SITE_URL)).toBe(true)
    expect(originAllowed(`${SITE_URL}/`)).toBe(true)
    expect(originAllowed('http://localhost:5173')).toBe(true)
    expect(originAllowed('http://localhost:8888')).toBe(true)
  })

  it('rejects any other origin, including one that only starts with the site name', () => {
    expect(originAllowed('https://evil.example')).toBe(false)
    expect(originAllowed('https://jdgafx-app-07-content-pipeline.netlify.app.evil.example')).toBe(false)
  })
})

describe('corsHeaders', () => {
  it('echoes an allowed origin and lists only the methods and headers the function uses', () => {
    expect(corsHeaders('https://example.test')).toEqual({
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
      'Access-Control-Allow-Origin': 'https://example.test',
    })
  })

  it('omits the allow-origin header when the request has no origin', () => {
    expect(corsHeaders(null)).not.toHaveProperty('Access-Control-Allow-Origin')
  })
})

describe('rateLimited', () => {
  it('allows 30 runs a minute from one client and refuses the 31st', () => {
    const results = Array.from({ length: 31 }, () => rateLimited('client-a'))
    expect(results.slice(0, 30).every(limited => !limited)).toBe(true)
    expect(results[30]).toBe(true)
  })

  it('counts each client separately', () => {
    expect(rateLimited('client-b')).toBe(false)
  })

  it('starts a new one-minute window after the first one ends', () => {
    vi.useFakeTimers()
    for (let i = 0; i < 30; i += 1) rateLimited('client-c')
    expect(rateLimited('client-c')).toBe(true)
    vi.advanceTimersByTime(60_001)
    expect(rateLimited('client-c')).toBe(false)
  })
})

describe('clientKey', () => {
  it('prefers the connection address that Netlify sets', () => {
    const req = new Request('https://example.test', {
      headers: { 'x-nf-client-connection-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.4' },
    })
    expect(clientKey(req)).toBe('203.0.113.9')
  })

  it('falls back to the first forwarded address', () => {
    const req = new Request('https://example.test', { headers: { 'x-forwarded-for': '198.51.100.4, 10.0.0.1' } })
    expect(clientKey(req)).toBe('198.51.100.4')
  })

  it('uses one shared key when no address is sent', () => {
    expect(clientKey(new Request('https://example.test'))).toBe('unknown')
  })
})
