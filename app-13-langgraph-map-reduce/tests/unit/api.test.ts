import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAnalysis } from '../../src/lib/api'
import type { Frame } from '../../src/types/frames'

const UNREACHABLE = 'Could not reach the server. Check your connection and try again.'
const encoder = new TextEncoder()

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A body that delivers one event, then fails the read the way a dropped connection does. */
function brokenBody(): ReadableStream<Uint8Array> {
  let sent = false
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(encoder.encode('data: {"type":"node_start","node":"split","ms":1,"detail":"Splitting"}\n\n'))
        return
      }
      controller.error(new TypeError('terminated'))
    },
  })
}

describe('runAnalysis', () => {
  it('reports a read that fails mid-run in plain words, after the frames already received', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(brokenBody(), { status: 200 })))
    const frames: Frame[] = []

    await expect(
      runAnalysis('x'.repeat(200), (frame) => frames.push(frame), new AbortController().signal),
    ).rejects.toThrow(UNREACHABLE)
    expect(frames).toEqual([{ type: 'node_start', node: 'split', ms: 1, detail: 'Splitting' }])
  })

  it('reports an unreachable server in plain words', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    await expect(runAnalysis('x'.repeat(200), () => undefined, new AbortController().signal)).rejects.toThrow(UNREACHABLE)
  })

  it('shows the server plain message when a start is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: false, error: 'Paste between 200 and 20,000 characters.' }), { status: 400 }),
      ),
    )

    await expect(runAnalysis('short', () => undefined, new AbortController().signal)).rejects.toThrow(
      'Paste between 200 and 20,000 characters.',
    )
  })
})
