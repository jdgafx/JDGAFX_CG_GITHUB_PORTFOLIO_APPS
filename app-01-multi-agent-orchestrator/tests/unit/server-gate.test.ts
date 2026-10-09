import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_QUERY_CHARS } from '../../src/lib/agents'
import { RequestError, clientKey, fail, rateLimit, readQuery, sseEvent } from '../../netlify/shared/gate'

const SITE = 'https://site.example'
const endpoint = `${SITE}/.netlify/functions/ai`

/** The gate reads its origin allowlist when it loads, so origin tests load it fresh. */
async function loadOriginGate(allowed: string) {
  vi.resetModules()
  vi.stubEnv('ALLOWED_ORIGINS', allowed)
  return import('../../netlify/shared/gate')
}

/** The status and message of a rejected request, failing the test if it did not reject. */
async function requestErrorOf(run: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await run
  } catch (err) {
    if (err instanceof RequestError) return { status: err.status, message: err.message }
    throw err
  }
  throw new Error('expected the request to be rejected')
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(endpoint, { method: 'POST', body, headers })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('origin allowlist', () => {
  it('lets listed origins and the request own host through, and nothing else', async () => {
    const gate = await loadOriginGate('https://allowed.example, https://other.example')
    const req = new Request(endpoint, { method: 'POST', headers: { 'x-forwarded-host': 'site.example' } })

    expect(gate.isOriginAllowed(req, null)).toBe(true)
    expect(gate.isOriginAllowed(req, 'https://allowed.example')).toBe(true)
    expect(gate.isOriginAllowed(req, SITE)).toBe(true)
    expect(gate.isOriginAllowed(req, 'https://evil.example')).toBe(false)
    expect(gate.isOriginAllowed(req, 'not a url')).toBe(false)
  })

  it('sends the Allow-Origin header only for an allowed origin', async () => {
    const gate = await loadOriginGate('https://allowed.example')
    const req = new Request(endpoint, { method: 'POST', headers: { 'x-forwarded-host': 'site.example' } })

    expect(gate.corsHeaders(req, 'https://allowed.example')['Access-Control-Allow-Origin']).toBe('https://allowed.example')
    expect(gate.corsHeaders(req, 'https://evil.example')['Access-Control-Allow-Origin']).toBeUndefined()
    expect(gate.corsHeaders(req, null).Vary).toBe('Origin')
  })
})

describe('rateLimit', () => {
  it('allows ten calls a minute per client, then denies with a retry time', () => {
    for (let i = 0; i < 10; i += 1) expect(rateLimit('gate-test-client-a').allowed).toBe(true)

    const denied = rateLimit('gate-test-client-a')
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfter).toBeGreaterThan(0)
    expect(denied.retryAfter).toBeLessThanOrEqual(60)
    expect(rateLimit('gate-test-client-b').allowed).toBe(true)
  })
})

describe('clientKey', () => {
  it('prefers the Netlify client IP, then the first forwarded address', () => {
    expect(
      clientKey(new Request(endpoint, { headers: { 'x-nf-client-connection-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.2' } })),
    ).toBe('203.0.113.7')
    expect(clientKey(new Request(endpoint, { headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' } }))).toBe('198.51.100.2')
    expect(clientKey(new Request(endpoint))).toBe('unknown')
  })
})

describe('error and event framing', () => {
  it('answers with JSON holding one plain-language error field and keeps extra headers', async () => {
    const res = fail('Missing query.', 400, { 'X-Test': 'yes' })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(res.headers.get('x-test')).toBe('yes')
    expect(await res.json()).toEqual({ error: 'Missing query.' })
  })

  it('frames one server-sent event', () => {
    expect(sseEvent({ type: 'agent_start', agent: 'researcher' })).toBe('data: {"type":"agent_start","agent":"researcher"}\n\n')
  })
})

describe('readQuery', () => {
  it('returns the trimmed query and ignores any model the client sends', async () => {
    expect(await readQuery(post('{"query":"  Why SSE?  ","model":"openai/gpt-4o"}'))).toBe('Why SSE?')
  })

  it('rejects each bad body with a 400 and a plain-language message', async () => {
    const cases: Array<[string, string]> = [
      ['not json', 'Invalid JSON.'],
      ['null', 'Missing query.'],
      ['{}', 'Missing query.'],
      ['{"query":"   "}', 'Missing query.'],
      ['{"query":42}', 'Query must be text.'],
      [JSON.stringify({ query: 'a'.repeat(MAX_QUERY_CHARS + 1) }), `Query too long: ${MAX_QUERY_CHARS} characters at most.`],
    ]
    for (const [body, message] of cases) {
      expect(await requestErrorOf(readQuery(post(body)))).toEqual({ status: 400, message })
    }
  })

  it('accepts a query of exactly the maximum length', async () => {
    const query = 'a'.repeat(MAX_QUERY_CHARS)
    expect(await readQuery(post(JSON.stringify({ query })))).toBe(query)
  })

  it('rejects a body over 8 KB, measured and declared', async () => {
    const big = JSON.stringify({ query: 'a'.repeat(8000), pad: 'x'.repeat(2000) })
    expect(new TextEncoder().encode(big).byteLength).toBeGreaterThan(8 * 1024)
    expect(await requestErrorOf(readQuery(post(big)))).toEqual({ status: 400, message: 'Request body too large.' })

    const declared = post('{"query":"hi"}', { 'content-length': '99999' })
    expect(await requestErrorOf(readQuery(declared))).toEqual({ status: 400, message: 'Request body too large.' })
  })
})
