import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/arxiv'

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35])
let clientCount = 0

function get(query: string, options: { method?: string; origin?: string; ip?: string } = {}): Request {
  clientCount += 1
  const headers: Record<string, string> = { 'x-nf-client-connection-ip': options.ip ?? `10.2.0.${clientCount}` }
  if (options.origin) headers['Origin'] = options.origin
  return new Request(`http://localhost/api/arxiv${query}`, { method: options.method ?? 'GET', headers })
}

let upstream: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  upstream = vi.fn(async () => new Response(PDF, { status: 200, headers: { 'Content-Type': 'application/pdf' } }))
  vi.stubGlobal('fetch', upstream)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('arxiv function', () => {
  it('returns the paper as a PDF with its length, fetched from the fixed arxiv.org URL', async () => {
    const res = await handler(get('?id=1706.03762'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-length')).toBe(String(PDF.byteLength))
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF)
    expect(upstream.mock.calls[0]?.[0]).toBe('https://arxiv.org/pdf/1706.03762')
  })

  it.each(['', '?id=', '?id=evil.example/x', '?id=https://evil.example/a.pdf', '?id=1706.03762%0A'])(
    'answers 400 for %j and makes no request',
    async query => {
      const res = await handler(get(query))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'That is not a valid arXiv ID.' })
      expect(upstream).not.toHaveBeenCalled()
    },
  )

  it('answers 405 to anything but GET', async () => {
    const res = await handler(get('?id=1706.03762', { method: 'POST' }))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET')
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers 403 to an origin that is not allowed', async () => {
    const res = await handler(get('?id=1706.03762', { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('passes arXiv failures on as plain sentences', async () => {
    upstream.mockResolvedValueOnce(new Response('', { status: 404 }))
    const res = await handler(get('?id=1706.03762'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'arXiv has no paper with that ID.' })
  })

  it('limits each address to 20 requests a minute', async () => {
    const results: number[] = []
    for (let i = 0; i < 21; i++) results.push((await handler(get('?id=1706.03762', { ip: '10.9.9.9' }))).status)
    expect(results.slice(0, 20).every(status => status === 200)).toBe(true)
    expect(results[20]).toBe(429)
  })
})
