import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIRST_TEXT_LIMIT_MS, RETRY_MIN_LEFT_MS, UPSTREAM_BUDGET_MS, streamVisionRun, type TraceStep, type VisionRun } from '../../netlify/shared/vision-run'

type Provider = (input: string, init?: RequestInit) => Promise<Response>

const CHECKED: TraceStep = { name: 'Request checked', status: 'ok', ms: 1, detail: 'Describe, image/png, about 1 KB' }
const NO_ANALYSIS = 'The vision service returned no usable analysis. Please retry with the same image.'
// The newest model the stubbed list names. Every reply in these tests is served by it, so the check matches.
const NEWEST = 'anthropic/claude-haiku-5.5'

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
    newest: () => Promise.resolve(NEWEST),
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
        { model: 'anthropic/claude-haiku-5.5', choices: [{ delta: { content: 'A red ' } }] },
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
          detail: 'anthropic/claude-haiku-5.5, 2 text chunks',
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
            detail: 'anthropic/claude-haiku-5.5, 2 text chunks',
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
        servedModel: 'anthropic/claude-haiku-5.5',
        newestModel: NEWEST,
        modelCheck: 'match',
        mismatchedModel: null,
        usageNotReported: 0,
        totalMs: expect.any(Number),
      },
    ])
  })

  it('reports tokens without inventing a cost when the provider omits it', async () => {
    stubFetch(async () =>
      sseReply([
        {
          model: 'anthropic/claude-haiku-5.5',
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
      servedModel: 'openai/content-safety-guard',
      newestModel: NEWEST,
      modelCheck: 'mismatch',
      mismatchedModel: 'openai/content-safety-guard',
      usageNotReported: 1,
      totalMs: expect.any(Number),
    })
  })

  it('keeps the partial text and marks a reply cut off by the token limit as truncated', async () => {
    stubFetch(async () =>
      sseReply([
        { model: 'anthropic/claude-haiku-5.5', choices: [{ delta: { content: 'The sign' } }] },
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

  it('never completes a stream that closes with text but no finish reason', async () => {
    stubFetch(async () =>
      sseReply([
        { model: 'anthropic/claude-haiku-5.5', choices: [{ delta: { content: 'The sign says' } }] },
        { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      ]),
    )

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames.some(frame => frame.stage === 'complete')).toBe(false)
    expect(frames.some(frame => 'result' in frame)).toBe(false)
    expect(frames.at(-2)).toMatchObject({
      stage: 'step',
      step: { name: 'Parse and validate', status: 'failed', detail: 'The stream ended without a finish reason, so the answer may be cut off' },
    })
    expect(frames.at(-1)).toMatchObject({
      stage: 'failed',
      error: 'The AI provider stopped the analysis partway through. Please retry.',
      truncated: true,
    })
  })

  it('fails a blank reply with the no-analysis message', async () => {
    stubFetch(async () => sseReply([{ model: 'anthropic/claude-haiku-5.5', choices: [{ delta: {}, finish_reason: 'stop' }] }]))

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames.at(-2)).toMatchObject({ step: { name: 'Parse and validate', status: 'failed', detail: 'No text was returned' } })
    expect(frames.at(-1)).toMatchObject({ stage: 'failed', error: NO_ANALYSIS, truncated: false })
  })
})

describe('streamVisionRun thinking', () => {
  it('sends no reasoning override in the request body', async () => {
    const provider = stubFetch(async () =>
      sseReply([{ model: 'anthropic/claude-haiku-5.5', choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] }]),
    )
    await framesOf(streamVisionRun(makeRun()))
    const body = JSON.parse(String(provider.mock.calls[0][1]?.body)) as { reasoning?: { enabled?: boolean } }
    expect(body.reasoning?.enabled === false).toBe(false)
    expect(body).not.toHaveProperty('reasoning')
  })

  it('shows only the answer when the stream carries reasoning deltas', async () => {
    stubFetch(async () =>
      sseReply([
        { model: 'anthropic/claude-haiku-5.5', choices: [{ delta: { role: 'assistant', content: '', reasoning: 'The user wants a sign. ' } }] },
        { choices: [{ delta: { content: '', reasoning: 'It looks red.', reasoning_details: [{ type: 'reasoning.text', text: 'It looks red.' }] } }] },
        { choices: [{ delta: { content: 'A red ' } }] },
        { choices: [{ delta: { content: 'sign.' }, finish_reason: 'stop' }] },
      ]),
    )

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames.filter(frame => 'text' in frame)).toEqual([{ text: 'A red ' }, { text: 'sign.' }])
    expect(JSON.stringify(frames)).not.toContain('The user wants')
    expect(JSON.stringify(frames)).not.toContain('It looks red')
    expect(frames.at(-1)).toMatchObject({ stage: 'complete', result: 'A red sign.' })
  })

  it('does not take thinking for a hang: reasoning that outlasts the first-word limit is not retried', async () => {
    vi.useFakeTimers()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const provider = stubFetch(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              controller = c
              c.enqueue(encoder.encode('data: {"model":"anthropic/claude-haiku-5.5","choices":[{"delta":{"reasoning":"Hmm"}}]}\n\n'))
            },
          }),
          { status: 200 },
        ),
    )

    const done = framesOf(streamVisionRun(makeRun()))
    await vi.advanceTimersByTimeAsync(FIRST_TEXT_LIMIT_MS + 3_000)
    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"A sign."},"finish_reason":"stop"}]}\n\n'))
    controller.close()
    const frames = await done

    expect(provider).toHaveBeenCalledTimes(1)
    expect(frames.at(-1)).toMatchObject({ stage: 'complete', result: 'A sign.' })
  })

  it('fails with a clear error when thinking used the whole limit and the answer is empty', async () => {
    stubFetch(async () =>
      sseReply([
        { model: 'anthropic/claude-haiku-5.5', choices: [{ delta: { content: '', reasoning: 'Thinking at length' } }] },
        { choices: [{ delta: { content: '' }, finish_reason: 'length' }] },
      ]),
    )

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames.some(frame => 'text' in frame)).toBe(false)
    expect(frames.at(-2)).toMatchObject({
      step: {
        name: 'Parse and validate',
        status: 'failed',
        detail: 'The token limit was used up by thinking before any answer was written',
      },
    })
    expect(frames.at(-1)).toMatchObject({
      stage: 'failed',
      error: 'The AI model used its whole output limit thinking and wrote no answer. Please retry with the same image.',
      truncated: false,
    })
    expect(frames.some(frame => frame.stage === 'complete')).toBe(false)
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
          // The provider accepts the connection after 5 seconds, sends one word, then goes quiet.
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Part"}}]}\n\n'))
            },
          })
          setTimeout(() => resolve(new Response(body, { status: 200 })), 5_000)
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
    expect(frames).toContainEqual({ text: 'Part' })
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

  it('ends a connection that never answers at the deadline even when fetch ignores the abort', async () => {
    vi.useFakeTimers()
    const provider = stubFetch(() => new Promise<Response>(() => {}))

    const done = framesOf(streamVisionRun(makeRun()))
    await vi.advanceTimersByTimeAsync(UPSTREAM_BUDGET_MS)
    const frames = await done

    // No retry: after a 12-second wait the rest of the budget cannot hold another full call.
    expect(provider).toHaveBeenCalledTimes(1)
    expect(frames.at(-3)).toMatchObject({
      stage: 'step',
      step: { name: 'Model call', status: 'failed', detail: 'No response from the AI provider within the time limit' },
    })
    expect(frames.at(-1)).toMatchObject({ stage: 'failed', error: 'The AI provider did not answer in time.', truncated: false, totalMs: 25_000 })
  })
})

describe('streamVisionRun hang retry', () => {
  const ok = () =>
    sseReply([
      { model: 'anthropic/claude-haiku-5.5', choices: [{ delta: { content: 'A sign.' }, finish_reason: 'stop' }] },
      { choices: [], usage: { total_tokens: 10 } },
    ])

  it('retries a fast failure once, shows it in the trace, and the retry runs under the same deadline', async () => {
    let calls = 0
    const provider = stubFetch(async () => {
      if (++calls === 1) throw new TypeError('fetch failed')
      return ok()
    })

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(provider).toHaveBeenCalledTimes(2)
    expect(frames).toContainEqual({
      stage: 'step',
      step: { name: 'Model call', status: 'running', detail: 'The first try got no answer. Retried once' },
    })
    expect(frames).toContainEqual({ text: 'A sign.' })
    expect(frames.at(-3)).toMatchObject({
      step: { name: 'Model call', status: 'ok', detail: 'anthropic/claude-haiku-5.5, 1 text chunks, retried once' },
    })
    expect(frames.at(-1)).toMatchObject({ stage: 'complete', result: 'A sign.' })
  })

  it('does not retry a call that says nothing for 12 seconds: the 13 seconds left cannot hold a full call (slowest measured 13.3 s)', async () => {
    vi.useFakeTimers()
    const provider = stubFetch(() => new Promise<Response>(() => {}))
    const done = framesOf(streamVisionRun(makeRun()))
    await vi.advanceTimersByTimeAsync(FIRST_TEXT_LIMIT_MS + 100)
    await vi.advanceTimersByTimeAsync(UPSTREAM_BUDGET_MS)
    const frames = await done
    expect(provider).toHaveBeenCalledTimes(1)
    expect(frames.at(-1)).toMatchObject({ stage: 'failed', error: 'The AI provider did not answer in time.', truncated: false })
  })

  it('pins the retry threshold to the slowest measured call with a 20% margin', () => {
    // 20 thinking-on single-image calls (SP2 browser runs and replays, plus in-process Extract replays): the slowest took 13,293 ms.
    expect(RETRY_MIN_LEFT_MS).toBe(Math.ceil((13_293 * 1.2) / 1_000) * 1_000)
    expect(RETRY_MIN_LEFT_MS).toBe(16_000)
  })

  it('retries a connection failure once, and gives up with the could-not-reach message after the second', async () => {
    const provider = stubFetch(async () => {
      throw new TypeError('fetch failed')
    })

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(provider).toHaveBeenCalledTimes(2)
    expect(frames.at(-1)).toMatchObject({ stage: 'failed', error: 'Could not reach the AI provider. Try again in a moment.' })
  })

  it.each([402, 429, 500])('never retries an HTTP %i from the provider', async status => {
    const provider = stubFetch(async () => new Response('{"error":"no"}', { status }))
    await framesOf(streamVisionRun(makeRun()))
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('does not retry once words have arrived', async () => {
    vi.useFakeTimers()
    const provider = stubFetch(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'))
            },
          }),
          { status: 200 },
        ),
    )
    const done = framesOf(streamVisionRun(makeRun()))
    await vi.advanceTimersByTimeAsync(UPSTREAM_BUDGET_MS)
    await done
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('does not retry when the budget left is too small for a second try', async () => {
    const provider = stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    await framesOf(streamVisionRun(makeRun({ startedAt: Date.now() - 10_000 })))
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('does not retry when the visitor stops the run', async () => {
    const provider = stubFetch(() => new Promise<Response>(() => {}))
    const response = streamVisionRun(makeRun())
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(provider).toHaveBeenCalledTimes(1)
  })
})

describe('streamVisionRun keep-alive liveness', () => {
  const KEEP_ALIVE = ': OPENROUTER PROCESSING\n\n'
  const encoder = new TextEncoder()

  // The provider sends a comment line every few seconds while the model thinks, and nothing else until it is done.
  function thinkingStream() {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })
    return { body, ping: () => controller.enqueue(encoder.encode(KEEP_ALIVE)), controller: () => controller }
  }

  it('counts keep-alive comment lines as liveness: a model still thinking after 12 seconds is not retried', async () => {
    vi.useFakeTimers()
    const stream = thinkingStream()
    const provider = stubFetch(async () => new Response(stream.body, { status: 200 }))

    const done = framesOf(streamVisionRun(makeRun()))
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(4_000)
      stream.ping()
    }
    stream.controller().enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"A sign."},"finish_reason":"stop"}]}\n\n'))
    stream.controller().close()
    const frames = await done

    expect(provider).toHaveBeenCalledTimes(1)
    expect(frames.at(-1)).toMatchObject({ stage: 'complete', result: 'A sign.' })
  })

  it('still ends at the 25-second deadline with the plain timeout message when only keep-alives ever arrive', async () => {
    vi.useFakeTimers()
    const stream = thinkingStream()
    const provider = stubFetch(async () => new Response(stream.body, { status: 200 }))

    const done = framesOf(streamVisionRun(makeRun()))
    for (let i = 0; i < 7; i += 1) {
      await vi.advanceTimersByTimeAsync(4_000)
      if (i < 6) stream.ping()
    }
    const frames = await done

    expect(provider).toHaveBeenCalledTimes(1)
    expect(frames.at(-1)).toMatchObject({
      stage: 'failed',
      error: 'The AI provider did not answer in time.',
      truncated: false,
      totalMs: 25_000,
    })
  })
})

describe('streamVisionRun billed usage', () => {
  const USAGE = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.0002 }
  const MODEL_NAMED = { model: 'anthropic/claude-haiku-5.5' }
  const usageOnly = (usage = USAGE) => ({ choices: [], usage })
  const encoder = new TextEncoder()
  const stepNamed = (frames: Record<string, unknown>[], name: string, status: string) =>
    frames.find(frame => frame.stage === 'step' && (frame.step as TraceStep).name === name && (frame.step as TraceStep).status === status)
      ?.step as TraceStep | undefined

  it('counts a reply cut off by the token limit: totals and the model row carry the billed usage', async () => {
    stubFetch(async () => sseReply([{ ...MODEL_NAMED, choices: [{ delta: { content: 'The sign' } }] }, { choices: [{ delta: {}, finish_reason: 'length' }] }, usageOnly()]))
    const frames = await framesOf(streamVisionRun(makeRun()))
    expect(frames.at(-1)).toMatchObject({ stage: 'failed', truncated: true, usage: USAGE, usageNotReported: 0 })
    expect(stepNamed(frames, 'Model call', 'ok')).toMatchObject({ tokens: 150, cost: 0.0002 })
  })

  it('counts a call where thinking used the whole limit and no answer was written', async () => {
    stubFetch(async () => sseReply([{ ...MODEL_NAMED, choices: [{ delta: { content: '', reasoning: 'Thinking' }, finish_reason: 'length' }] }, usageOnly()]))
    const frames = await framesOf(streamVisionRun(makeRun()))
    expect(frames.at(-1)).toMatchObject({ stage: 'failed', usage: USAGE, usageNotReported: 0 })
    expect(stepNamed(frames, 'Model call', 'ok')).toMatchObject({ tokens: 150, cost: 0.0002 })
  })

  it('counts an empty reply', async () => {
    stubFetch(async () => sseReply([{ ...MODEL_NAMED, choices: [{ delta: {}, finish_reason: 'stop' }] }, usageOnly()]))
    const frames = await framesOf(streamVisionRun(makeRun()))
    expect(frames.at(-1)).toMatchObject({ stage: 'failed', usage: USAGE, usageNotReported: 0 })
    expect(stepNamed(frames, 'Model call', 'ok')).toMatchObject({ tokens: 150, cost: 0.0002 })
  })

  it('counts a reply the provider filtered', async () => {
    stubFetch(async () => sseReply([{ ...MODEL_NAMED, choices: [{ delta: { content: 'x' }, finish_reason: 'content_filter' }] }, usageOnly()]))
    const frames = await framesOf(streamVisionRun(makeRun()))
    expect(frames.at(-1)).toMatchObject({ stage: 'failed', usage: USAGE, usageNotReported: 0 })
  })

  it('counts a comparison that failed the three-part check', async () => {
    stubFetch(async () => sseReply([{ ...MODEL_NAMED, choices: [{ delta: { content: '## Similarities\n- a' }, finish_reason: 'stop' }] }, usageOnly()]))
    const frames = await framesOf(streamVisionRun(makeRun({ mode: 'compare' })))
    expect(frames.at(-1)).toMatchObject({ stage: 'failed', usage: USAGE, usageNotReported: 0 })
    expect(stepNamed(frames, 'Model call', 'ok')).toMatchObject({ tokens: 150, cost: 0.0002 })
  })

  it('puts the usage on the failed model row when the provider ends the stream with an error after it reported usage', async () => {
    stubFetch(async () => sseReply([{ ...MODEL_NAMED, choices: [{ delta: { content: 'Hi' } }] }, usageOnly(), { error: { message: 'upstream broke' } }]))
    const frames = await framesOf(streamVisionRun(makeRun()))
    expect(frames.at(-1)).toMatchObject({ stage: 'failed', usage: USAGE, usageNotReported: 0 })
    expect(stepNamed(frames, 'Model call', 'failed')).toMatchObject({ tokens: 150, cost: 0.0002 })
  })

  it('reports a normal run with every call counted', async () => {
    stubFetch(async () => sseReply([{ ...MODEL_NAMED, choices: [{ delta: { content: 'A sign.' }, finish_reason: 'stop' }] }, usageOnly()]))
    const frames = await framesOf(streamVisionRun(makeRun()))
    expect(frames.at(-1)).toMatchObject({ stage: 'complete', usage: USAGE, usageNotReported: 0 })
  })

  it('counts every attempt of a retry: the first try reported usage before it dropped, the second answered', async () => {
    let calls = 0
    stubFetch(async () => {
      if (++calls > 1) return sseReply([{ ...MODEL_NAMED, choices: [{ delta: { content: 'A sign.' }, finish_reason: 'stop' }] }, usageOnly({ ...USAGE, total_tokens: 300, cost: 0.0005 })])
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(usageOnly())}\n\n`))
        },
        pull(controller) {
          controller.error(new TypeError('socket closed'))
        },
      })
      return new Response(body, { status: 200 })
    })
    const frames = await framesOf(streamVisionRun(makeRun()))
    expect(frames.at(-1)).toMatchObject({
      stage: 'complete',
      usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 450, cost: 0.0007 },
      usageNotReported: 0,
    })
    expect(stepNamed(frames, 'Model call (first try)', 'failed')).toMatchObject({ tokens: 150, cost: 0.0002 })
  })

  it('marks the total partial when a retried first try never reported: its row says so and the second try is counted', async () => {
    let calls = 0
    stubFetch(async () => {
      if (++calls === 1) throw new TypeError('fetch failed')
      return sseReply([{ ...MODEL_NAMED, choices: [{ delta: { content: 'Part' }, finish_reason: 'length' }] }, usageOnly()])
    })
    const frames = await framesOf(streamVisionRun(makeRun()))
    expect(frames.at(-1)).toMatchObject({ stage: 'failed', usage: USAGE, usageNotReported: 1 })
    expect(stepNamed(frames, 'Model call (first try)', 'failed')).toMatchObject({ detail: expect.stringContaining('usage not reported') })
  })

  it('shows not reported, and a partial count, when nothing ever answers: the one try is unknown', async () => {
    vi.useFakeTimers()
    stubFetch(() => new Promise<Response>(() => {}))
    const done = framesOf(streamVisionRun(makeRun()))
    await vi.advanceTimersByTimeAsync(UPSTREAM_BUDGET_MS)
    expect((await done).at(-1)).toMatchObject({ stage: 'failed', usage: null, usageNotReported: 1 })
  })

  it('counts both tries as not reported when a fast failure is retried and fails again', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    expect((await framesOf(streamVisionRun(makeRun()))).at(-1)).toMatchObject({ stage: 'failed', usage: null, usageNotReported: 2 })
  })

  it('marks the total partial when the stream is cut at the deadline after some text and before any usage', async () => {
    vi.useFakeTimers()
    stubFetch(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Part"}}]}\n\n'))
            },
          }),
          { status: 200 },
        ),
    )
    const done = framesOf(streamVisionRun(makeRun()))
    await vi.advanceTimersByTimeAsync(UPSTREAM_BUDGET_MS)
    expect((await done).at(-1)).toMatchObject({ stage: 'failed', truncated: true, usage: null, usageNotReported: 1 })
  })

  it('marks the total partial when the connection drops mid-answer before the usage chunk', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'))
      },
      pull(controller) {
        controller.error(new TypeError('socket closed'))
      },
    })
    stubFetch(async () => new Response(body, { status: 200 }))
    expect((await framesOf(streamVisionRun(makeRun()))).at(-1)).toMatchObject({ stage: 'failed', usage: null, usageNotReported: 1 })
  })

  it('does not call a refused request partial: an HTTP 402 from the provider billed nothing', async () => {
    stubFetch(async () => new Response('{"error":"no credit"}', { status: 402 }))
    expect((await framesOf(streamVisionRun(makeRun()))).at(-1)).toMatchObject({ stage: 'failed', usage: null, usageNotReported: 0 })
  })
})

describe('streamVisionRun comparison check', () => {
  const reply = (text: string) => sseReply([{ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }])

  it('completes a comparison that has all three parts', async () => {
    stubFetch(async () => reply('## Similarities\n- Both are red\n## Differences\n- One is bigger\n## Verdict\nB wins.'))
    const frames = await framesOf(streamVisionRun(makeRun({ mode: 'compare' })))
    expect(frames.at(-1)).toMatchObject({ stage: 'complete' })
  })

  it('fails a comparison that has no verdict, and names what is missing', async () => {
    stubFetch(async () => reply('## Similarities\n- Both are red\n## Differences\n- One is bigger'))
    const frames = await framesOf(streamVisionRun(makeRun({ mode: 'compare' })))
    expect(frames.at(-2)).toMatchObject({
      step: { name: 'Parse and validate', status: 'failed', detail: 'The reply has no verdict' },
    })
    expect(frames.at(-1)).toMatchObject({
      stage: 'failed',
      error: 'The comparison came back without all three parts. Please run it again.',
    })
  })

  it('does not apply the three-part check to other modes', async () => {
    stubFetch(async () => reply('Just a sentence.'))
    const frames = await framesOf(streamVisionRun(makeRun()))
    expect(frames.at(-1)).toMatchObject({ stage: 'complete' })
  })
})
