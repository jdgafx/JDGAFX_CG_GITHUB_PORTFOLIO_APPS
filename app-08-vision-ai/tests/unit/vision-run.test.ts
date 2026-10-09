import { afterEach, describe, expect, it, vi } from 'vitest'
import { UPSTREAM_BUDGET_MS, streamVisionRun, type TraceStep, type VisionRun } from '../../netlify/shared/vision-run'

type Provider = (input: string, init?: RequestInit) => Promise<Response>

const CHECKED: TraceStep = { name: 'Request checked', status: 'ok', ms: 1, detail: 'Describe, image/png, about 1 KB' }
const NO_ANALYSIS = 'The vision service returned no usable analysis. Please retry with the same image.'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function makeRun(overrides: Partial<VisionRun> = {}): VisionRun {
  return {
    provider: { url: 'https://provider.test/chat', apiKey: 'test-only-placeholder' },
    messages: [{ role: 'system', content: 'Describe it.' }],
    maxTokens: 4096,
    startedAt: Date.now(),
    checked: CHECKED,
    ...overrides,
  }
}

function stubFetch(reply: () => Promise<Response>) {
  const mock = vi.fn<Provider>(() => reply())
  vi.stubGlobal('fetch', mock)
  return mock
}

function sseReply(chunks: unknown[]): Response {
  const body = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

// Reads the whole SSE body, checks that it ends with [DONE], and returns the frames before it.
async function framesOf(response: Response): Promise<Record<string, unknown>[]> {
  const raw = await response.text()
  const blocks = raw.split('\n\n').filter(block => block !== '')
  expect(blocks.at(-1)).toBe('data: [DONE]')
  return blocks.slice(0, -1).map(block => {
    expect(block.startsWith('data: ')).toBe(true)
    return JSON.parse(block.slice('data: '.length)) as Record<string, unknown>
  })
}

describe('streamVisionRun happy path', () => {
  it('streams text deltas, then a complete frame with the served model, usage and cost', async () => {
    const provider = stubFetch(async () =>
      sseReply([
        { model: 'anthropic/claude-haiku-4.5', choices: [{ delta: { content: 'A red ' } }] },
        { choices: [{ delta: { content: 'sign.' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 } },
      ]),
    )

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(provider).toHaveBeenCalledTimes(1)
    const [url, init] = provider.mock.calls[0]
    expect(url).toBe('https://provider.test/chat')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: '~anthropic/claude-haiku-latest',
      max_tokens: 4096,
      usage: { include: true },
    })
    expect(frames).toEqual([
      { stage: 'step', step: CHECKED },
      { stage: 'step', step: { name: 'Model call', status: 'running', detail: 'Request sent to the vision model' } },
      { text: 'A red ' },
      { text: 'sign.' },
      {
        stage: 'step',
        step: {
          name: 'Model call',
          status: 'ok',
          ms: expect.any(Number),
          detail: 'anthropic/claude-haiku-4.5, 2 text chunks',
          tokens: 1200,
          cost: 0.0002,
        },
      },
      {
        stage: 'step',
        step: {
          name: 'Parse and validate',
          status: 'ok',
          ms: expect.any(Number),
          detail: '11 characters, finish reason stop',
        },
      },
      {
        stage: 'complete',
        result: 'A red sign.',
        trace: [
          CHECKED,
          {
            name: 'Model call',
            status: 'ok',
            ms: expect.any(Number),
            detail: 'anthropic/claude-haiku-4.5, 2 text chunks',
            tokens: 1200,
            cost: 0.0002,
          },
          {
            name: 'Parse and validate',
            status: 'ok',
            ms: expect.any(Number),
            detail: '11 characters, finish reason stop',
          },
        ],
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 },
        model: 'anthropic/claude-haiku-4.5',
        totalMs: expect.any(Number),
      },
    ])
  })

  it('reports tokens without inventing a cost when the provider omits it', async () => {
    stubFetch(async () =>
      sseReply([
        {
          model: 'anthropic/claude-haiku-4.5',
          choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        },
      ]),
    )

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames.at(-1)).toMatchObject({ stage: 'complete', usage: { total_tokens: 7 } })
    expect(frames.at(-1)?.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 })
    const modelStep = frames.at(-3)
    expect(modelStep).toMatchObject({ step: { name: 'Model call', status: 'ok', tokens: 7 } })
    expect(modelStep).not.toHaveProperty('step.cost')
  })
})

describe('streamVisionRun content and token checks', () => {
  it('never shows a moderation reply: it fails the call and emits no text', async () => {
    stubFetch(async () => sseReply([{ model: 'openai/content-safety-guard', choices: [{ delta: { content: 'Safe' } }] }]))

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames.some(frame => 'text' in frame)).toBe(false)
    expect(frames.at(-1)).toEqual({
      stage: 'failed',
      error: NO_ANALYSIS,
      truncated: false,
      trace: [
        CHECKED,
        {
          name: 'Model call',
          status: 'failed',
          ms: expect.any(Number),
          detail: 'Answered by a moderation model, not the analysis model',
        },
        { name: 'Parse and validate', status: 'skipped', detail: 'Skipped because the model call did not finish' },
      ],
      usage: null,
      model: 'openai/content-safety-guard',
      totalMs: expect.any(Number),
    })
  })

  it('keeps the partial text and marks a reply cut off by the token limit as truncated', async () => {
    stubFetch(async () =>
      sseReply([
        { model: 'anthropic/claude-haiku-4.5', choices: [{ delta: { content: 'The sign' } }] },
        { choices: [{ delta: {}, finish_reason: 'length' }] },
      ]),
    )

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames).toContainEqual({ text: 'The sign' })
    expect(frames.at(-2)).toMatchObject({
      stage: 'step',
      step: { name: 'Parse and validate', status: 'failed', detail: 'Output reached the token limit before the analysis finished' },
    })
    expect(frames.at(-1)).toMatchObject({
      stage: 'failed',
      error: 'The vision service stopped before the analysis finished. Please retry with the same image.',
      truncated: true,
    })
  })

  it('fails a blank reply with the no-analysis message', async () => {
    stubFetch(async () => sseReply([{ model: 'anthropic/claude-haiku-4.5', choices: [{ delta: {}, finish_reason: 'stop' }] }]))

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames.at(-2)).toMatchObject({ step: { name: 'Parse and validate', status: 'failed', detail: 'No text was returned' } })
    expect(frames.at(-1)).toMatchObject({ stage: 'failed', error: NO_ANALYSIS, truncated: false })
  })
})

describe('streamVisionRun failure mapping', () => {
  it('maps a provider 402 to plain words and never forwards the provider body', async () => {
    stubFetch(async () => new Response('{"error":{"message":"Insufficient credits, account acct_123"}}', { status: 402 }))

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(JSON.stringify(frames)).not.toContain('acct_123')
    expect(frames.some(frame => 'text' in frame)).toBe(false)
    expect(frames.at(-3)).toMatchObject({
      stage: 'step',
      step: { name: 'Model call', status: 'failed', detail: 'The AI provider rejected the key or is out of credit.' },
    })
    expect(frames.at(-1)).toMatchObject({
      stage: 'failed',
      error: 'The AI provider rejected the key or is out of credit.',
      truncated: false,
    })
  })

  it('maps a provider 500 to the did-not-answer message', async () => {
    stubFetch(async () => new Response('upstream exploded', { status: 500 }))

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames.at(-1)).toMatchObject({ stage: 'failed', error: 'The AI provider did not answer in time.' })
  })

  it('maps a connection that gets no response (AbortError) to the timeout message', async () => {
    stubFetch(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    })

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames.at(-3)).toMatchObject({
      stage: 'step',
      step: { name: 'Model call', status: 'failed', detail: 'No response from the AI provider within the time limit' },
    })
    expect(frames.at(-1)).toMatchObject({ stage: 'failed', error: 'The AI provider did not answer in time.' })
  })

  it('maps a network failure to the could-not-reach message', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames.at(-1)).toMatchObject({
      stage: 'failed',
      error: 'Could not reach the AI provider. Try again in a moment.',
    })
  })

  it('keeps the partial answer and fails plainly when the connection drops mid-answer', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'))
      },
      pull(controller) {
        controller.error(new TypeError('socket closed'))
      },
    })
    stubFetch(async () => new Response(body, { status: 200 }))

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames).toContainEqual({ text: 'Partial' })
    expect(frames.at(-3)).toMatchObject({
      stage: 'step',
      step: { name: 'Model call', status: 'failed', detail: 'The connection to the AI provider dropped mid-answer' },
    })
    expect(frames.at(-1)).toMatchObject({
      stage: 'failed',
      error: 'The AI provider stopped the analysis partway through. Please retry.',
      truncated: false,
    })
  })
})

describe('streamVisionRun deadline', () => {
  it('stops the whole call at one 25-second deadline shared by connecting and reading', async () => {
    vi.useFakeTimers()
    const provider = stubFetch(
      () =>
        new Promise<Response>(resolve => {
          // The provider accepts the connection after 20 seconds, then never sends a byte.
          setTimeout(() => resolve(new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 })), 20_000)
        }),
    )

    let finished = false
    const done = framesOf(streamVisionRun(makeRun())).then(frames => {
      finished = true
      return frames
    })

    await vi.advanceTimersByTimeAsync(24_000)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    const frames = await done

    expect(provider).toHaveBeenCalledTimes(1)
    expect(UPSTREAM_BUDGET_MS).toBe(25_000)
    expect(frames.at(-3)).toMatchObject({
      stage: 'step',
      step: { name: 'Model call', status: 'failed', detail: 'Stopped at the 25-second limit; partial output kept' },
    })
    expect(frames.at(-1)).toMatchObject({
      stage: 'failed',
      error: 'The AI provider did not answer in time. The partial answer above may be incomplete.',
      truncated: true,
      totalMs: 25_000,
    })
  })
})
