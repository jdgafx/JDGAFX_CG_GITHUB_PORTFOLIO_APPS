import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeImage, upsertStep, type TraceStep } from '../../src/lib/api'

// Node has no FileReader. This stand-in reads the File's bytes the same way the browser does.
class FakeFileReader {
  result: string | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  readAsDataURL(file: Blob): void {
    file.arrayBuffer().then(
      buffer => {
        this.result = `data:${file.type};base64,${Buffer.from(buffer).toString('base64')}`
        this.onload?.()
      },
      () => this.onerror?.(),
    )
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

const hi = new File([new Uint8Array([104, 105])], 'hi.png', { type: 'image/png' }) // bytes of "hi"
const CHECKED: TraceStep = { name: 'Request checked', status: 'ok', ms: 1, detail: 'Describe, image/png, about 1 KB' }

beforeEach(() => {
  vi.stubGlobal('FileReader', FakeFileReader)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function stubFetch(reply: () => Promise<Response>) {
  const mock = vi.fn<Fetch>(() => reply())
  vi.stubGlobal('fetch', mock)
  return mock
}

function sseReply(frames: unknown[]): Response {
  const body = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function jsonReply(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('analyzeImage with a streamed reply', () => {
  it('streams text and returns the complete result with the served model and cost', async () => {
    const modelOk: TraceStep = {
      name: 'Model call',
      status: 'ok',
      ms: 900,
      detail: 'anthropic/claude-haiku-5.5, 2 text chunks',
      tokens: 1200,
      cost: 0.0002,
    }
    const parseOk: TraceStep = { name: 'Parse and validate', status: 'ok', ms: 0, detail: '11 characters, finish reason stop' }
    const fetchMock = stubFetch(async () =>
      sseReply([
        { stage: 'step', step: CHECKED },
        { stage: 'step', step: { name: 'Model call', status: 'running', detail: 'Request sent to the vision model' } },
        { text: 'A red ' },
        { text: 'sign.' },
        { stage: 'step', step: modelOk },
        { stage: 'step', step: parseOk },
        {
          stage: 'complete',
          result: 'A red sign.',
          trace: [CHECKED, modelOk, parseOk],
          usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 },
          model: 'anthropic/claude-haiku-5.5',
          totalMs: 1200,
        },
      ]),
    )
    const steps: TraceStep[] = []
    const texts: string[] = []

    const outcome = await analyzeImage({
      file: hi,
      mode: 'describe',
      onStep: step => steps.push(step),
      onText: text => texts.push(text),
    })

    expect(outcome).toEqual({
      status: 'complete',
      result: 'A red sign.',
      summary: {
        trace: [CHECKED, modelOk, parseOk],
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 },
        model: 'anthropic/claude-haiku-5.5',
        totalMs: 1200,
      },
    })
    expect(texts).toEqual(['A red ', 'sign.'])
    expect(steps.map(step => `${step.name}:${step.status}`)).toEqual([
      'Request checked:ok',
      'Model call:running',
      'Model call:ok',
      'Parse and validate:ok',
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/ai', expect.objectContaining({ method: 'POST' }))
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(sent).toEqual({ image: 'aGk=', mediaType: 'image/png', mode: 'describe' })
  })

  it('sends the question only in Question mode', async () => {
    const fetchMock = stubFetch(async () =>
      sseReply([{ stage: 'complete', result: 'Two words.', trace: [], usage: null, model: null, totalMs: 5 }]),
    )

    await analyzeImage({ file: hi, mode: 'qa', question: 'What words appear?', onStep: () => undefined, onText: () => undefined })

    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(sent).toEqual({ image: 'aGk=', mediaType: 'image/png', mode: 'qa', question: 'What words appear?' })
  })

  it('returns the failed frame message, truncation flag and trace from the server', async () => {
    stubFetch(async () =>
      sseReply([
        { stage: 'step', step: { name: 'Model call', status: 'failed', ms: 40, detail: 'Stopped at the 25-second limit; partial output kept' } },
        {
          stage: 'failed',
          error: 'The AI provider did not answer in time. The partial answer above may be incomplete.',
          truncated: true,
          trace: [{ name: 'Model call', status: 'failed', ms: 40, detail: 'Stopped at the 25-second limit; partial output kept' }],
          usage: null,
          model: null,
          totalMs: 25000,
        },
      ]),
    )

    const outcome = await analyzeImage({ file: hi, mode: 'describe', onStep: () => undefined, onText: () => undefined })

    expect(outcome).toMatchObject({
      status: 'failed',
      message: 'The AI provider did not answer in time. The partial answer above may be incomplete.',
      truncated: true,
      summary: { totalMs: 25000, model: null },
    })
  })

  it('reports a dropped stream with no terminal frame and never treats the partial answer as complete', async () => {
    stubFetch(async () =>
      new Response('data: {"stage":"step","step":{"name":"Request checked","status":"ok","detail":"x"}}\n\n', {
        status: 200,
      }),
    )

    const outcome = await analyzeImage({ file: hi, mode: 'describe', onStep: () => undefined, onText: () => undefined })

    expect(outcome).toMatchObject({
      status: 'failed',
      message: 'The connection dropped before the analysis finished. The result above may be incomplete.',
      truncated: false,
    })
  })
})

describe('analyzeImage request failures', () => {
  it('shows the trace step the server recorded for a rejected request', async () => {
    const fetchMock = stubFetch(async () =>
      jsonReply(
        {
          error: 'Image is too large. Please use an image under 4MB.',
          trace: [{ name: 'Request checked', status: 'failed', ms: 3, detail: 'Image is too large. Please use an image under 4MB.' }],
          totalMs: 3,
        },
        400,
      ),
    )

    const outcome = await analyzeImage({ file: hi, mode: 'describe', onStep: () => undefined, onText: () => undefined })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({
      status: 'failed',
      message: 'Image is too large. Please use an image under 4MB.',
      truncated: false,
      summary: {
        trace: [
          {
            name: 'Request checked',
            status: 'failed',
            ms: 3,
            detail: 'Image is too large. Please use an image under 4MB.',
          },
        ],
        usage: null,
        model: null,
        totalMs: expect.any(Number),
      },
    })
  })

  it('falls back to a status message when the rejected reply is not JSON', async () => {
    stubFetch(async () => new Response('<html>Bad gateway</html>', { status: 502 }))

    const outcome = await analyzeImage({ file: hi, mode: 'describe', onStep: () => undefined, onText: () => undefined })

    expect(outcome.status).toBe('failed')
    expect(outcome.summary.trace).toEqual([
      expect.objectContaining({ name: 'Request checked', status: 'failed' }),
    ])
    expect(outcome).toMatchObject({ message: 'The analysis could not start (HTTP 502). Please try again.' })
  })

  it('reports a network failure in plain words', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })

    const outcome = await analyzeImage({ file: hi, mode: 'describe', onStep: () => undefined, onText: () => undefined })

    expect(outcome).toMatchObject({
      status: 'failed',
      message: 'Could not reach the server. Check your connection and try again.',
    })
  })

  it('rejects an unsupported file type before calling the server', async () => {
    const fetchMock = stubFetch(async () => sseReply([]))
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })

    const outcome = await analyzeImage({ file: svg, mode: 'describe', onStep: () => undefined, onText: () => undefined })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({
      status: 'failed',
      message: 'Unsupported file type: image/svg+xml. Please use JPG, PNG, WebP, or GIF.',
    })
  })
})

describe('analyzeImage timing and cancel', () => {
  it('ends a run that gets no answer within 60 seconds with the provider timeout message', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn<Fetch>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const stop = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            if (init?.signal?.aborted) stop()
            else init?.signal?.addEventListener('abort', stop)
          }),
      ),
    )

    const pending = analyzeImage({ file: hi, mode: 'describe', onStep: () => undefined, onText: () => undefined })
    await vi.advanceTimersByTimeAsync(60_000)
    const outcome = await pending

    expect(outcome).toMatchObject({ status: 'failed', message: 'The AI provider did not answer in time.' })
    expect(outcome.summary.totalMs).toBe(60_000)
    // Nothing was running, so the trace still names the step that never answered.
    expect(outcome.summary.trace).toEqual([
      expect.objectContaining({ name: 'Model call', status: 'failed', detail: 'No answer within 60 seconds' }),
    ])
  })

  it('reports a run stopped by the user as cancelled and leaves no step running', async () => {
    const controller = new AbortController()
    let markRequested: () => void = () => undefined
    const requestSent = new Promise<void>(resolve => {
      markRequested = () => resolve()
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<Fetch>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            markRequested()
            init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
          }),
      ),
    )

    const pending = analyzeImage({
      file: hi,
      mode: 'describe',
      signal: controller.signal,
      onStep: () => undefined,
      onText: () => undefined,
    })
    await requestSent
    controller.abort()
    const outcome = await pending

    expect(outcome.status).toBe('cancelled')
    expect(outcome.summary.trace).toEqual([])
  })
})

describe('upsertStep', () => {
  it('appends a new step and replaces one with the same name without changing the order or the input', () => {
    const running: TraceStep = { name: 'Model call', status: 'running', detail: 'sent' }
    const done: TraceStep = { name: 'Model call', status: 'ok', ms: 800, detail: 'answered' }
    const start = [CHECKED]

    const withRunning = upsertStep(start, running)
    const withDone = upsertStep(withRunning, done)

    expect(start).toEqual([CHECKED])
    expect(withRunning.map(step => step.status)).toEqual(['ok', 'running'])
    expect(withDone).toEqual([CHECKED, done])
  })
})
