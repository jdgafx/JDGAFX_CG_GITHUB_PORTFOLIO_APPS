import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Frame } from '../../netlify/shared/events'
import { INTERRUPTED_MESSAGE, NETWORK_MESSAGE, streamResearch } from '../../src/lib/research'
import { createSseParser } from '../../src/lib/sse'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createSseParser', () => {
  it('joins a record that arrives split across two reads', () => {
    const got: string[] = []
    const parser = createSseParser((data) => got.push(data))
    parser.push('data: {"type":"node_st')
    parser.push('art"}\n\ndata: [DONE]\n\n')
    expect(got).toEqual(['{"type":"node_start"}', '[DONE]'])
  })

  it('reads CRLF line endings and several records in one read', () => {
    const got: string[] = []
    const parser = createSseParser((data) => got.push(data))
    parser.push('data: one\r\n\r\ndata: two\n\ndata: three\n\n')
    expect(got).toEqual(['one', 'two', 'three'])
  })

  it('passes on a last record that has no blank line after it when flushed', () => {
    const got: string[] = []
    const parser = createSseParser((data) => got.push(data))
    parser.push('data: tail')
    expect(got).toEqual([])
    parser.flush()
    expect(got).toEqual(['tail'])
  })

  it('ignores comment lines and records with no data', () => {
    const got: string[] = []
    const parser = createSseParser((data) => got.push(data))
    parser.push(': keep-alive\n\nevent: ping\n\n')
    expect(got).toEqual([])
  })
})

describe('streamResearch', () => {
  it('posts the question and passes each frame on until the [DONE] record', async () => {
    const body = [
      'data: {"type":"node_start","node":"plan","visit":1,"ms":2}',
      '',
      'data: {"type":"error","message":"Stopped."}',
      '',
      'data: [DONE]',
      '',
      '',
    ].join('\n')
    const fetchStub = vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }))
    vi.stubGlobal('fetch', fetchStub)

    const frames: Frame[] = []
    await streamResearch('Hi', new AbortController().signal, (frame) => frames.push(frame))

    expect(frames).toEqual([
      { type: 'node_start', node: 'plan', visit: 1, ms: 2 },
      { type: 'error', message: 'Stopped.' },
    ])
    const [url, init] = fetchStub.mock.calls[0] ?? []
    expect(url).toBe('/api/run')
    expect(init).toMatchObject({ method: 'POST', body: '{"question":"Hi"}' })
  })

  it('rejects with the message the server sent when it refuses the request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: false, error: 'The question must be 1 to 500 characters.' }, { status: 400 })),
    )
    await expect(streamResearch('', new AbortController().signal, () => undefined)).rejects.toThrow(
      'The question must be 1 to 500 characters.',
    )
  })

  it('rejects with the network message when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    await expect(streamResearch('Hi', new AbortController().signal, () => undefined)).rejects.toThrow(NETWORK_MESSAGE)
  })

  it('rejects when the stream ends before the [DONE] record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('data: {"type":"error","message":"x"}\n\n', { status: 200 })),
    )
    await expect(streamResearch('Hi', new AbortController().signal, () => undefined)).rejects.toThrow(
      INTERRUPTED_MESSAGE,
    )
  })

  it('resolves quietly when the visitor cancels', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError')
      }),
    )
    await expect(streamResearch('Hi', controller.signal, () => undefined)).resolves.toBeUndefined()
  })
})
