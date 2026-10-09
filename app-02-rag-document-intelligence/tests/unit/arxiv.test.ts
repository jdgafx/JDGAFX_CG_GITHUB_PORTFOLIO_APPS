import { afterEach, describe, expect, it, vi } from 'vitest'
import { arxivAbsUrl, arxivProxyPath, parseArxivId } from '../../src/lib/arxivId'
import { arxivPdfUrl, fetchArxivPdf, MAX_PDF_BYTES, NOT_A_PDF_MESSAGE, TOO_LARGE_MESSAGE } from '../../netlify/shared/arxiv'

describe('parseArxivId', () => {
  it.each([
    ['1706.03762', '1706.03762'],
    ['  2101.00001v2 ', '2101.00001v2'],
    ['arXiv:1706.03762', '1706.03762'],
    ['hep-th/9901001', 'hep-th/9901001'],
    ['math.GT/0309136v1', 'math.GT/0309136v1'],
    ['https://arxiv.org/abs/1706.03762', '1706.03762'],
    ['https://arxiv.org/pdf/1706.03762v7.pdf', '1706.03762v7'],
    ['https://www.arxiv.org/abs/hep-th/9901001?context=cs', 'hep-th/9901001'],
  ])('reads %s as %s', (input, id) => {
    expect(parseArxivId(input)).toBe(id)
  })

  it.each([
    '',
    'attention',
    '1706.037',
    '1706.037621234',
    '../../etc/passwd',
    '1706.03762/../x',
    'https://evil.example/abs/1706.03762',
    'https://arxiv.org.evil.example/abs/1706.03762',
    'hep-th/99010',
  ])('rejects %j', input => {
    expect(parseArxivId(input)).toBeNull()
  })

  it('builds the abstract link and the function path', () => {
    expect(arxivAbsUrl('1706.03762')).toBe('https://arxiv.org/abs/1706.03762')
    expect(arxivProxyPath('hep-th/9901001')).toBe('/api/arxiv?id=hep-th%2F9901001')
  })
})

describe('arxivPdfUrl', () => {
  it('puts a valid ID after the fixed arxiv.org host', () => {
    expect(arxivPdfUrl('1706.03762')).toBe('https://arxiv.org/pdf/1706.03762')
    expect(arxivPdfUrl('hep-th/9901001v2')).toBe('https://arxiv.org/pdf/hep-th/9901001v2')
  })

  it('refuses anything that is not an ID, so no other host or path can be built', () => {
    expect(() => arxivPdfUrl('evil.example/x')).toThrow()
    expect(() => arxivPdfUrl('1706.03762@evil.example')).toThrow()
    expect(() => arxivPdfUrl('//evil.example')).toThrow()
    expect(() => arxivPdfUrl('1706.03762\n')).toThrow()
  })
})

describe('fetchArxivPdf', () => {
  afterEach(() => vi.unstubAllGlobals())

  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35])
  const pdfResponse = (body: BodyInit = PDF, headers: Record<string, string> = {}) =>
    new Response(body, { status: 200, headers: { 'Content-Type': 'application/pdf', ...headers } })

  function stub(...replies: Array<() => Response>) {
    const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
      const next = replies.shift()
      if (!next) throw new Error('unexpected fetch')
      return next()
    })
    vi.stubGlobal('fetch', mock)
    return mock
  }

  it('returns the bytes of a PDF fetched from arxiv.org without following redirects blindly', async () => {
    const mock = stub(() => pdfResponse())
    const result = await fetchArxivPdf('1706.03762')
    expect(result).toEqual({ ok: true, bytes: PDF })
    expect(mock).toHaveBeenCalledTimes(1)
    expect(mock.mock.calls[0]?.[0]).toBe('https://arxiv.org/pdf/1706.03762')
    expect(mock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
  })

  it('answers 400 for a bad ID without any request', async () => {
    const mock = stub()
    expect(await fetchArxivPdf('https://evil.example/x')).toMatchObject({ ok: false, status: 400 })
    expect(mock).not.toHaveBeenCalled()
  })

  it('maps a missing paper to 404 and a rate limit to 429', async () => {
    stub(() => new Response('nope', { status: 404 }), () => new Response('slow down', { status: 429 }))
    expect(await fetchArxivPdf('1706.03762')).toEqual({ ok: false, status: 404, message: 'arXiv has no paper with that ID.' })
    expect(await fetchArxivPdf('1706.03762')).toMatchObject({ ok: false, status: 429 })
  })

  it('refuses a reply that is not a PDF, such as an HTML page for a withdrawn paper', async () => {
    stub(() => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    expect(await fetchArxivPdf('1706.03762')).toEqual({ ok: false, status: 502, message: NOT_A_PDF_MESSAGE })
  })

  it('refuses a declared size over the cap without reading the body', async () => {
    stub(() => pdfResponse(PDF, { 'Content-Length': String(MAX_PDF_BYTES + 1) }))
    expect(await fetchArxivPdf('1706.03762')).toEqual({ ok: false, status: 413, message: TOO_LARGE_MESSAGE })
  })

  it('stops reading a body that grows past the cap even when it declares no size', async () => {
    let cancelled = false
    let sent = 0
    const MB = 1024 * 1024
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += MB
        controller.enqueue(new Uint8Array(MB))
      },
      cancel() {
        cancelled = true
      },
    })
    stub(() => pdfResponse(body))
    expect(await fetchArxivPdf('1706.03762')).toEqual({ ok: false, status: 413, message: TOO_LARGE_MESSAGE })
    expect(cancelled).toBe(true)
    expect(sent).toBeLessThanOrEqual(MAX_PDF_BYTES + 2 * MB)
  })

  it('follows a redirect that stays on arxiv.org over https', async () => {
    const mock = stub(
      () => new Response(null, { status: 301, headers: { Location: '/pdf/1706.03762v7' } }),
      () => pdfResponse(),
    )
    expect((await fetchArxivPdf('1706.03762')).ok).toBe(true)
    expect(mock.mock.calls[1]?.[0]).toBe('https://arxiv.org/pdf/1706.03762v7')
  })

  it.each(['https://evil.example/x.pdf', 'http://arxiv.org/pdf/1706.03762', 'https://arxiv.org.evil.example/p'])(
    'refuses a redirect to %s and makes no second request',
    async location => {
      const mock = stub(() => new Response(null, { status: 302, headers: { Location: location } }))
      expect(await fetchArxivPdf('1706.03762')).toEqual({ ok: false, status: 502, message: NOT_A_PDF_MESSAGE })
      expect(mock).toHaveBeenCalledTimes(1)
    },
  )

  it('gives up on a redirect loop', async () => {
    const loop = () => new Response(null, { status: 302, headers: { Location: '/pdf/1706.03762' } })
    const mock = stub(loop, loop, loop, loop, loop)
    expect(await fetchArxivPdf('1706.03762')).toMatchObject({ ok: false, status: 502 })
    expect(mock).toHaveBeenCalledTimes(4)
  })

  it('maps a timeout to 504 and a network failure to 502', async () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(timeout)))
    expect(await fetchArxivPdf('1706.03762')).toMatchObject({ ok: false, status: 504 })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    expect(await fetchArxivPdf('1706.03762')).toMatchObject({ ok: false, status: 502 })
    vi.restoreAllMocks()
  })
})
