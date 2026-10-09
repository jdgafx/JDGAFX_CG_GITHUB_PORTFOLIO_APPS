import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArxivError, fetchArxivFile, MAX_PDF_BYTES, STALL_MS, TOO_LARGE_MESSAGE } from '../../src/lib/arxiv'
import { arxivAbsUrl, arxivPdfUrl, parseArxivId } from '../../src/lib/arxivId'

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

  it('builds the abstract link', () => {
    expect(arxivAbsUrl('1706.03762')).toBe('https://arxiv.org/abs/1706.03762')
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

describe('fetchArxivFile', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35])
  const pdfResponse = (body: BodyInit = PDF, headers: Record<string, string> = {}) =>
    new Response(body, { status: 200, headers: { 'Content-Type': 'application/pdf', ...headers } })

  type Reply = () => Response | Promise<Response>
  function stub(...replies: Reply[]) {
    const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
      const next = replies.shift()
      if (!next) throw new Error('unexpected fetch')
      return next()
    })
    vi.stubGlobal('fetch', mock)
    return mock
  }
  const networkFailure: Reply = () => Promise.reject(new TypeError('Failed to fetch'))
  const failure = async (promise: Promise<unknown>) => {
    const err: unknown = await promise.then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ArxivError)
    return (err as ArxivError).message
  }

  it('returns the paper as a PDF file named after its ID, fetched from the fixed arxiv.org URL', async () => {
    const mock = stub(() => pdfResponse())
    const file = await fetchArxivFile('hep-th/9901001')
    expect(file.name).toBe('hep-th_9901001.pdf')
    expect(file.type).toBe('application/pdf')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PDF)
    expect(mock).toHaveBeenCalledTimes(1)
    expect(mock.mock.calls[0]?.[0]).toBe('https://arxiv.org/pdf/hep-th/9901001')
  })

  it('refuses a bad ID without any request', async () => {
    const mock = stub()
    await expect(fetchArxivFile('https://evil.example/x')).rejects.toThrow()
    expect(mock).not.toHaveBeenCalled()
  })

  it('maps a readable 404 and 429 to plain sentences', async () => {
    stub(() => new Response('nope', { status: 404 }), () => new Response('slow', { status: 429 }), () => new Response('x', { status: 503 }))
    expect(await failure(fetchArxivFile('1706.03762'))).toBe('arXiv has no paper with that ID.')
    expect(await failure(fetchArxivFile('1706.03762'))).toBe('arXiv is rate limiting requests. Try again in a minute.')
    expect(await failure(fetchArxivFile('1706.03762'))).toBe('arXiv could not provide that paper right now. Try again shortly.')
  })

  it('refuses a reply that is not a PDF', async () => {
    stub(() => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    expect(await failure(fetchArxivFile('1706.03762'))).toBe('arXiv did not return a PDF for that ID.')
  })

  it('refuses a declared size over the cap without reading the body', async () => {
    stub(() => pdfResponse(PDF, { 'Content-Length': String(MAX_PDF_BYTES + 1) }))
    expect(await failure(fetchArxivFile('1706.03762'))).toBe(TOO_LARGE_MESSAGE)
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
    expect(await failure(fetchArxivFile('1706.03762'))).toBe(TOO_LARGE_MESSAGE)
    expect(cancelled).toBe(true)
    expect(sent).toBeLessThanOrEqual(MAX_PDF_BYTES + 2 * MB)
  })

  it('tries once more after a request that failed outright, and succeeds if the second works', async () => {
    const mock = stub(networkFailure, () => pdfResponse())
    expect((await fetchArxivFile('1706.03762')).size).toBe(PDF.byteLength)
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('gives one plain sentence after two failed requests, and does not try a third time', async () => {
    const mock = stub(networkFailure, networkFailure)
    expect(await failure(fetchArxivFile('1706.03762'))).toMatch(/^Could not load that paper from arXiv\./)
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a readable error such as a 404', async () => {
    const mock = stub(() => new Response('nope', { status: 404 }))
    await failure(fetchArxivFile('1706.03762'))
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('cuts off a reply that never starts, after the stall limit', async () => {
    vi.useFakeTimers()
    const mock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }),
    )
    vi.stubGlobal('fetch', mock)
    const outcome = failure(fetchArxivFile('1706.03762'))
    await vi.advanceTimersByTimeAsync(STALL_MS - 1)
    expect(mock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toBe('arXiv did not answer in time. Try again.')
  })

  it('cuts off a download that stops sending, but not one that is merely slow', async () => {
    vi.useFakeTimers()
    let enqueue: (chunk: Uint8Array) => void = () => undefined
    // Like a real fetch body, this one errors when the request's signal aborts.
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          enqueue = chunk => controller.enqueue(chunk)
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
        },
      })
      return pdfResponse(body)
    }))
    let settled = false
    const outcome = failure(fetchArxivFile('1706.03762')).finally(() => {
      settled = true
    })
    // Chunks keep arriving just inside the limit, for far longer than one limit in total.
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(STALL_MS - 1000)
      enqueue(new Uint8Array(10))
    }
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(STALL_MS)
    expect(await outcome).toBe('arXiv stopped sending the paper. Try again.')
  })

  it('lets a download that keeps receiving bytes run past 90 seconds, since only a stall ends it', async () => {
    vi.useFakeTimers()
    let enqueue: (chunk: Uint8Array) => void = () => undefined
    let close: () => void = () => undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          enqueue = chunk => controller.enqueue(chunk)
          close = () => controller.close()
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
        },
      })
      return pdfResponse(body)
    }))
    const outcome = fetchArxivFile('1706.03762')
    await vi.advanceTimersByTimeAsync(0)
    // 12 chunks, 10 s apart: 120 s in all, and never a quiet spell as long as the stall limit.
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(10_000)
      enqueue(new Uint8Array(100))
    }
    close()
    expect((await outcome).size).toBe(1200)
  })

  it('rethrows the caller abort as it is, so a cancelled load shows no error', async () => {
    const caller = new AbortController()
    stub(async () => {
      caller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    await expect(fetchArxivFile('1706.03762', caller.signal)).rejects.not.toBeInstanceOf(ArxivError)
  })
})
