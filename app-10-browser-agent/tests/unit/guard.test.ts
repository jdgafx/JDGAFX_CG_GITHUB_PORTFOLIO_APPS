import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  allowedOrigins,
  CuratedError,
  clientKey,
  corsHeaders,
  jsonResponse,
  originAllowed,
  rateLimited,
  readJson,
} from '../../netlify/shared/guard'

const PROD = 'https://jdgafx-app-10-browser-agent.netlify.app'

beforeEach(() => {
  // Netlify sets these on real deploys. Blank them so the origin list is the same on every machine.
  vi.stubEnv('ALLOWED_ORIGINS', '')
  vi.stubEnv('URL', '')
  vi.stubEnv('DEPLOY_PRIME_URL', '')
  vi.stubEnv('DEPLOY_URL', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('originAllowed', () => {
  it('accepts a request with no Origin header, such as a server-to-server call', () => {
    expect(originAllowed(null)).toBe(true)
  })

  it('accepts the production site with or without a trailing slash', () => {
    expect(originAllowed(PROD)).toBe(true)
    expect(originAllowed(`${PROD}/`)).toBe(true)
  })

  it('accepts the local dev origins', () => {
    expect(originAllowed('http://localhost:5173')).toBe(true)
    expect(originAllowed('http://localhost:8888')).toBe(true)
  })

  it('rejects any other site, including one that only starts with the production name', () => {
    expect(originAllowed('https://evil.example')).toBe(false)
    expect(originAllowed('https://jdgafx-app-10-browser-agent.netlify.app.evil.example')).toBe(false)
    expect(originAllowed('null')).toBe(false)
  })
})

describe('allowedOrigins', () => {
  it('adds the configured and Netlify deploy origins, normalised, to the production and local ones', () => {
    vi.stubEnv('ALLOWED_ORIGINS', 'https://preview.example.com/, https://staging.example.com')
    vi.stubEnv('URL', 'https://site.example.com/')
    vi.stubEnv('DEPLOY_URL', 'https://deploy-preview-7--site.example.com')
    expect(allowedOrigins()).toEqual([
      'https://preview.example.com',
      'https://staging.example.com',
      'https://site.example.com',
      'https://deploy-preview-7--site.example.com',
      PROD,
      'http://localhost:8888',
      'http://localhost:5173',
    ])
  })
})

describe('corsHeaders', () => {
  it('echoes an allowed origin and never sends a wildcard', () => {
    const headers = corsHeaders(PROD)
    expect(headers['Access-Control-Allow-Origin']).toBe(PROD)
    expect(headers.Vary).toBe('Origin')
    expect(headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS')
    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type')
  })

  it('omits the allow-origin header for any other site or none', () => {
    expect(corsHeaders('https://evil.example')).not.toHaveProperty('Access-Control-Allow-Origin')
    expect(corsHeaders(null)).not.toHaveProperty('Access-Control-Allow-Origin')
  })
})

describe('rateLimited', () => {
  it('allows the limit and refuses the call after it', () => {
    const results = Array.from({ length: 4 }, () => rateLimited('test:limit', 3))
    expect(results).toEqual([false, false, false, true])
  })

  it('keeps separate counts for separate clients', () => {
    expect(rateLimited('test:client-a', 1)).toBe(false)
    expect(rateLimited('test:client-a', 1)).toBe(true)
    expect(rateLimited('test:client-b', 1)).toBe(false)
  })

  it('starts a new window after one minute', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
    expect(rateLimited('test:window', 1)).toBe(false)
    expect(rateLimited('test:window', 1)).toBe(true)
    vi.setSystemTime(new Date('2026-10-08T12:01:00.001Z'))
    expect(rateLimited('test:window', 1)).toBe(false)
  })
})

describe('clientKey', () => {
  it('prefers the Netlify client address, then the first forwarded address, then unknown', () => {
    const both = new Request('https://site.example/', {
      headers: { 'x-nf-client-connection-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.4, 10.0.0.1' },
    })
    expect(clientKey(both)).toBe('203.0.113.9')

    const forwarded = new Request('https://site.example/', { headers: { 'x-forwarded-for': '198.51.100.4, 10.0.0.1' } })
    expect(clientKey(forwarded)).toBe('198.51.100.4')

    expect(clientKey(new Request('https://site.example/'))).toBe('unknown')
  })
})

describe('readJson', () => {
  it('parses a JSON body under the cap', async () => {
    const req = new Request('https://site.example/', { method: 'POST', body: '{"task":"Open google.com"}' })
    await expect(readJson(req, 100)).resolves.toEqual({ task: 'Open google.com' })
  })

  it('refuses a declared length over the cap', async () => {
    const req = new Request('https://site.example/', {
      method: 'POST',
      headers: { 'content-length': '5000' },
      body: '{}',
    })
    const failure = readJson(req, 100)
    await expect(failure).rejects.toBeInstanceOf(CuratedError)
    await expect(failure).rejects.toThrow('The request is too large.')
  })

  it('counts bytes, not characters, when the body has no length header', async () => {
    // 60 two-byte letters plus the JSON wrapper: 71 characters but 131 bytes.
    const req = new Request('https://site.example/', { method: 'POST', body: `{"task":"${'é'.repeat(60)}"}` })
    await expect(readJson(req, 100)).rejects.toThrow('The request is too large.')
  })

  it('reports invalid JSON in plain words', async () => {
    const req = new Request('https://site.example/', { method: 'POST', body: '{"task":' })
    await expect(readJson(req, 100)).rejects.toThrow('The request body is not valid JSON.')
  })
})

describe('jsonResponse', () => {
  it('returns a JSON body with the given status and headers', async () => {
    const response = jsonResponse({ error: 'Enter a task first.' }, 400, { Vary: 'Origin' })
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('vary')).toBe('Origin')
    await expect(response.json()).resolves.toEqual({ error: 'Enter a task first.' })
  })
})
