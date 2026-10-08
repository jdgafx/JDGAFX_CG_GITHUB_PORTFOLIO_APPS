import { describe, expect, it } from 'vitest'
import {
  corsHeaders,
  guardRequest,
  isDeadlineError,
  jsonError,
  providerFailure,
  readLimitedText,
  upstreamStatus,
} from '../../netlify/shared/http'
import { ORIGIN, request } from '../helpers'

const URL_AI = 'http://localhost/api/ai'

async function bodyOf(res: Response): Promise<{ error?: string; trace?: unknown[] }> {
  return (await res.json()) as { error?: string; trace?: unknown[] }
}

describe('guardRequest', () => {
  it('answers a preflight from an allowed origin with 204 and echoes that origin', () => {
    const res = guardRequest(request(URL_AI, { method: 'OPTIONS' }))

    expect(res?.status).toBe(204)
    expect(res?.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(res?.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
  })

  it('refuses a preflight from an unknown origin with 403', async () => {
    const res = guardRequest(request(URL_AI, { method: 'OPTIONS', origin: 'https://evil.example' }))

    expect(res?.status).toBe(403)
    expect((await bodyOf(res as Response)).error).toBe('Origin not allowed')
  })

  it('answers 405 to GET from an allowed origin', async () => {
    const res = guardRequest(request(URL_AI, { method: 'GET' }))

    expect(res?.status).toBe(405)
    expect((await bodyOf(res as Response)).error).toBe('Method not allowed')
  })

  it('refuses an unknown origin before it checks the method', async () => {
    const res = guardRequest(request(URL_AI, { method: 'GET', origin: 'https://evil.example' }))

    expect(res?.status).toBe(403)
    expect((await bodyOf(res as Response)).error).toBe('Origin not allowed')
  })

  it('allows a POST that has no origin header, such as a server-to-server call', () => {
    expect(guardRequest(request(URL_AI, { origin: null }))).toBeNull()
  })

  it('allows a POST from an allowed origin', () => {
    expect(guardRequest(request(URL_AI))).toBeNull()
  })

  it('throttles one client after 20 requests in the window', async () => {
    const client = { 'x-nf-client-connection-ip': '192.0.2.77' }
    const allowed = Array.from({ length: 20 }, () => guardRequest(new Request(URL_AI, {
      method: 'POST',
      headers: { ...client, origin: ORIGIN },
    })))

    expect(allowed.every(result => result === null)).toBe(true)

    const res = guardRequest(new Request(URL_AI, { method: 'POST', headers: { ...client, origin: ORIGIN } }))
    expect(res?.status).toBe(429)
    expect((await bodyOf(res as Response)).error).toBe('Too many requests. Wait a moment and try again.')
  })
})

describe('jsonError and corsHeaders', () => {
  it('shapes an error body with the trace and echoes an allowed origin', async () => {
    const res = jsonError('Nope.', 418, ORIGIN, { trace: [{ name: 'request built' }], totalMs: 7 })

    expect(res.status).toBe(418)
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(await res.json()).toEqual({ error: 'Nope.', trace: [{ name: 'request built' }], totalMs: 7 })
  })

  it('sends no origin echo when the request had no origin', () => {
    expect(corsHeaders(null)['Access-Control-Allow-Origin']).toBeUndefined()
    expect(corsHeaders(null).Vary).toBe('Origin')
  })
})

describe('upstreamStatus', () => {
  it.each([
    [429, 429],
    [500, 503],
    [503, 503],
    [402, 502],
    [401, 502],
    [400, 502],
  ])('maps an upstream %i to %i', (upstream, status) => {
    expect(upstreamStatus(upstream)).toBe(status)
  })
})

describe('providerFailure', () => {
  it('names the key or credit problem for 401 and 402', () => {
    expect(providerFailure('The AI provider', 401)).toBe('The AI provider rejected the key or is out of credit.')
    expect(providerFailure('The AI provider', 402)).toBe('The AI provider rejected the key or is out of credit.')
  })

  it('gives the rate limit copy for 429', () => {
    expect(providerFailure('The AI provider', 429)).toBe('Rate limited, try again in a minute.')
  })

  it('says the provider did not answer in time for any 5xx', () => {
    expect(providerFailure('The AI provider', 500)).toBe('The AI provider did not answer in time.')
    expect(providerFailure('The AI provider', 503)).toBe('The AI provider did not answer in time.')
  })

  it('uses the service name it is given', () => {
    expect(providerFailure('The transcription service', 402)).toBe(
      'The transcription service rejected the key or is out of credit.',
    )
  })

  it('reports other statuses by number only', () => {
    expect(providerFailure('The AI provider', 404)).toBe('The AI provider did not accept the request (HTTP 404).')
  })
})

describe('readLimitedText', () => {
  it('returns the body when it fits the limit', async () => {
    const req = new Request(URL_AI, { method: 'POST', body: 'hello' })

    expect(await readLimitedText(req, 100)).toBe('hello')
  })

  it('refuses a body whose declared length is above the limit', async () => {
    const req = new Request(URL_AI, {
      method: 'POST',
      headers: { 'content-length': '999999' },
      body: 'tiny',
    })

    expect(await readLimitedText(req, 100)).toBeNull()
  })

  it('refuses a body whose measured length is above the limit', async () => {
    const req = new Request(URL_AI, { method: 'POST', body: 'x'.repeat(200) })

    expect(await readLimitedText(req, 100)).toBeNull()
  })

  it('measures bytes, not characters', async () => {
    // 40 euro signs are 40 characters but 120 UTF-8 bytes.
    const req = new Request(URL_AI, { method: 'POST', body: '€'.repeat(40) })

    expect(await readLimitedText(req, 100)).toBeNull()
    expect(await readLimitedText(new Request(URL_AI, { method: 'POST', body: '€'.repeat(30) }), 100)).toBe(
      '€'.repeat(30),
    )
  })
})

describe('isDeadlineError', () => {
  it('treats a TimeoutError and an AbortError as the deadline', () => {
    expect(isDeadlineError(Object.assign(new Error('late'), { name: 'TimeoutError' }))).toBe(true)
    expect(isDeadlineError(Object.assign(new Error('late'), { name: 'AbortError' }))).toBe(true)
  })

  it('does not treat other errors, or non-errors, as the deadline', () => {
    expect(isDeadlineError(new TypeError('fetch failed'))).toBe(false)
    expect(isDeadlineError('AbortError')).toBe(false)
    expect(isDeadlineError(null)).toBe(false)
  })
})
