import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDLE_TIMEOUT_MS, analyzeImage, type TraceStep } from '../../src/lib/api'

// The browser's canvas is not available here; these stand-ins return a known crop and pass images through.
vi.mock('../../src/lib/image', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/lib/image')>()
  return {
    ...original,
    cropRegion: vi.fn(async (file: File) => ({
      file: new File([new Uint8Array([1, 2, 3])], 'region-412x260.png', { type: 'image/png' }),
      rect: { x: 180, y: 96, width: 412, height: 260 },
      source: { width: 1280, height: file.size },
    })),
    fitForCompare: vi.fn(async (file: File) => ({ file, shrunk: false })),
  }
})

class FakeFileReader {
  result: string | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsDataURL(file: Blob): void {
    file.arrayBuffer().then(buffer => {
      this.result = `data:${file.type};base64,${Buffer.from(buffer).toString('base64')}`
      this.onload?.()
    })
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>
const hi = new File([new Uint8Array([104, 105])], 'hi.png', { type: 'image/png' })
const ho = new File([new Uint8Array([104, 111])], 'ho.jpg', { type: 'image/jpeg' })

beforeEach(() => {
  vi.stubGlobal('FileReader', FakeFileReader)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const complete = frame({ stage: 'complete', result: 'Done.', trace: [], usage: null, model: null, totalMs: 5 })

function stubFetch(reply: () => Promise<Response>) {
  const mock = vi.fn<Fetch>(() => reply())
  vi.stubGlobal('fetch', mock)
  return mock
}

const noop = () => undefined

describe('region requests', () => {
  it('crops in the browser, reports the crop, and sends only the crop with its place in the picture', async () => {
    const provider = stubFetch(async () => new Response(complete + 'data: [DONE]\n\n'))
    const crops: string[] = []
    const steps: TraceStep[] = []

    const outcome = await analyzeImage({
      file: hi,
      mode: 'region',
      question: 'What does the sign say?',
      box: { x: 0.14, y: 0.11, w: 0.32, h: 0.3 },
      onCrop: crop => crops.push(crop.file.name),
      onStep: step => steps.push(step),
      onText: noop,
    })

    expect(crops).toEqual(['region-412x260.png'])
    const body = JSON.parse(String(provider.mock.calls[0][1]?.body))
    expect(body).toMatchObject({
      mode: 'region',
      question: 'What does the sign say?',
      mediaType: 'image/png',
      image: Buffer.from([1, 2, 3]).toString('base64'),
      region: { sourceWidth: 1280, sourceHeight: 2, x: 180, y: 96, width: 412, height: 260 },
    })
    expect(steps[0]).toMatchObject({ name: 'Crop region', status: 'running' })
    expect(outcome.summary.trace[0]).toMatchObject({
      name: 'Crop region',
      status: 'ok',
      detail: '412 × 260 px from 1,280 × 2 px, 0 KB at full resolution',
    })
  })
})

describe('compare requests', () => {
  it('sends both images and keeps the prepare step in front of the server steps', async () => {
    const provider = stubFetch(async () => new Response(complete + 'data: [DONE]\n\n'))

    const outcome = await analyzeImage({ file: hi, fileB: ho, mode: 'compare', question: 'Which is better?', onStep: noop, onText: noop })

    const body = JSON.parse(String(provider.mock.calls[0][1]?.body))
    expect(body).toMatchObject({
      mode: 'compare',
      question: 'Which is better?',
      mediaType: 'image/png',
      mediaType2: 'image/jpeg',
      image: Buffer.from('hi').toString('base64'),
      image2: Buffer.from('ho').toString('base64'),
    })
    expect(outcome.summary.trace.map(step => step.name)).toEqual(['Prepare images'])
    expect(outcome.status).toBe('complete')
  })

  it('stops before the network when the second image is missing', async () => {
    const provider = stubFetch(async () => new Response(''))
    const outcome = await analyzeImage({ file: hi, mode: 'compare', onStep: noop, onText: noop })
    expect(provider).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ status: 'failed', message: 'Choose a second image to compare.' })
  })
})

describe('trace naming and the closing request', () => {
  it('names the step "Reach the server" when the server cannot be reached, not "Request checked"', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    const outcome = await analyzeImage({ file: hi, mode: 'describe', onStep: noop, onText: noop })
    expect(outcome.summary.trace).toEqual([
      expect.objectContaining({ name: 'Reach the server', status: 'failed' }),
    ])
  })

  it('lets a finished stream close by itself instead of cancelling it', async () => {
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(complete + 'data: [DONE]\n\n'))
        controller.close()
      },
      cancel: cancelled,
    })
    stubFetch(async () => new Response(body))
    const outcome = await analyzeImage({ file: hi, mode: 'describe', onStep: noop, onText: noop })
    expect(outcome.status).toBe('complete')
    expect(cancelled).not.toHaveBeenCalled()
  })

  it('does not wait for a server that never closes the stream after the final frame', async () => {
    vi.useFakeTimers()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(complete))
      },
    })
    stubFetch(async () => new Response(body))
    const pending = analyzeImage({ file: hi, mode: 'describe', onStep: noop, onText: noop })
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await pending).status).toBe('complete')
  })
})

describe('the no-data watchdog', () => {
  it('gives up with a plain message when no byte arrives for 30 seconds, keeping the words that came', async () => {
    vi.useFakeTimers()
    // Like a real fetch, aborting the request errors the body that is being read.
    vi.stubGlobal(
      'fetch',
      vi.fn<Fetch>(async (_input, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(frame({ text: 'A sign' })))
            init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
          },
        })
        return new Response(body)
      }),
    )
    const text: string[] = []
    const pending = analyzeImage({ file: hi, mode: 'describe', onStep: noop, onText: t => text.push(t) })
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS)
    const outcome = await pending
    expect(text).toEqual(['A sign'])
    expect(outcome).toMatchObject({
      status: 'failed',
      message: 'No data arrived for 30 seconds, so the page stopped waiting. Run it again.',
    })
  })
})
