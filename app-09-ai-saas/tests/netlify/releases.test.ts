import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFetch, jsonResponse } from './helpers'

type Handler = (req: Request) => Promise<Response>

async function load(): Promise<{ handler: Handler; config: { path: string } }> {
  vi.resetModules()
  const mod = await import('../../netlify/functions/releases')
  return { handler: mod.default as Handler, config: mod.config as { path: string } }
}

const get = (name: string | null, headers: Record<string, string> = {}, method = 'GET') =>
  new Request(`https://site.test/api/releases${name === null ? '' : `?name=${encodeURIComponent(name)}`}`, { method, headers })

// Registry document: `time` holds created, modified and one stamp per version.
const doc = {
  name: 'demo',
  time: {
    created: '2015-01-01T00:00:00.000Z',
    modified: '2026-10-01T00:00:00.000Z',
    '1.0.0': '2024-01-01T00:00:00.000Z', // older than 400 days
    '2.0.0': '2025-09-06T23:59:59.000Z', // one day too old (the cut-off day is 2025-09-07)
    '2.1.0': '2025-09-07T00:00:01.000Z', // oldest kept
    '3.0.0-beta.1': '2026-03-01T10:00:00.000Z', // pre-release
    '3.0.0': '2026-03-05T10:00:00.000Z',
    '3.0.1': '2026-03-05T11:00:00.000Z',
    '3.1.0-rc.0': '2026-09-01T10:00:00.000Z',
    '3.2.0': '2026-10-10T09:00:00.000Z',
  },
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('GET /api/releases', () => {
  it('serves /api/releases', async () => {
    expect((await load()).config.path).toBe('/api/releases')
  })

  it('keeps stable versions from the last 400 days, oldest first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
    installFetch({ registry: () => jsonResponse(doc) })
    const { handler } = await load()
    const res = await handler(get('demo'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      name: 'demo',
      status: 'ok',
      releases: [
        { day: '2025-09-07', version: '2.1.0' },
        { day: '2026-03-05', version: '3.0.0' },
        { day: '2026-03-05', version: '3.0.1' },
        { day: '2026-10-10', version: '3.2.0' },
      ],
    })
  })

  it('sets the cache headers, with Netlify-Vary on the name query', async () => {
    installFetch({ registry: () => jsonResponse(doc) })
    const { handler } = await load()
    const res = await handler(get('demo'))
    expect(res.headers.get('Netlify-CDN-Cache-Control')).toBe('public, s-maxage=600')
    expect(res.headers.get('Netlify-Vary')).toBe('query=name')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300')
  })

  it('makes one registry request per name, so two names are two cache keys', async () => {
    const calls = installFetch({ registry: () => jsonResponse(doc) })
    const { handler } = await load()
    const a = await handler(get('react'))
    const b = await handler(get('@anthropic-ai/sdk'))
    expect(a.headers.get('Netlify-Vary')).toBe('query=name')
    expect(b.headers.get('Netlify-Vary')).toBe('query=name')
    expect(calls.map((c) => c.url)).toEqual(['https://registry.npmjs.org/react', 'https://registry.npmjs.org/@anthropic-ai%2Fsdk'])
    expect(((await a.json()) as { name: string }).name).toBe('react')
    expect(((await b.json()) as { name: string }).name).toBe('@anthropic-ai/sdk')
  })

  it('sends the portfolio user agent and nothing personal', async () => {
    const calls = installFetch({ registry: () => jsonResponse(doc) })
    const { handler } = await load()
    await handler(get('demo'))
    const headers = calls[0]?.init?.headers as Record<string, string>
    expect(headers['User-Agent']).toBe('jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)')
  })

  describe('failure returns status failed and is never cached', () => {
    it.each([
      ['a 404', () => jsonResponse({ error: 'Not found' }, 404)],
      ['a 500', () => jsonResponse({}, 500)],
      ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
      ['a body that is not JSON', () => new Response('<html>', { status: 200 })],
      ['a document with no time', () => jsonResponse({ name: 'demo' })],
    ])('on %s', async (_label, registry) => {
      installFetch({ registry })
      const { handler } = await load()
      const res = await handler(get('demo'))
      expect(await res.json()).toEqual({ name: 'demo', status: 'failed', releases: [] })
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(res.headers.get('Netlify-CDN-Cache-Control')).toBeNull()
    })
    it('at the 15 s timeout, even when the registry ignores the abort', async () => {
      vi.useFakeTimers()
      installFetch({ registry: () => new Promise<Response>(() => undefined) })
      const { handler } = await load()
      const pending = handler(get('demo'))
      await vi.advanceTimersByTimeAsync(14_999)
      let done = false
      void pending.then(() => { done = true })
      await vi.advanceTimersByTimeAsync(0)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await (await pending).json()).toEqual({ name: 'demo', status: 'failed', releases: [] })
    })
  })

  it('answers 400 to a missing or invalid name and 405 to POST, with no registry call', async () => {
    const calls = installFetch({ registry: () => jsonResponse(doc) })
    const { handler } = await load()
    expect((await handler(get(null))).status).toBe(400)
    expect((await handler(get('../etc/passwd'))).status).toBe(400)
    expect((await handler(get('a b'))).status).toBe(400)
    expect((await handler(get('demo', {}, 'POST'))).status).toBe(405)
    expect(calls).toHaveLength(0)
  })

  it('answers 403 to a cross-site origin and accepts its own origin', async () => {
    const calls = installFetch({ registry: () => jsonResponse(doc) })
    const { handler } = await load()
    expect((await handler(get('demo', { origin: 'https://evil.example' }))).status).toBe(403)
    expect(calls).toHaveLength(0)
    expect((await handler(get('demo', { origin: 'https://site.test' }))).status).toBe(200)
  })
})
