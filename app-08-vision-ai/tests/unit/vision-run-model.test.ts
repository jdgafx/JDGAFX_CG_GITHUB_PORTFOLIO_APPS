import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIRST_TEXT_LIMIT_MS, streamVisionRun, type TraceStep, type VisionRun } from '../../netlify/shared/vision-run'

type Provider = (input: string, init?: RequestInit) => Promise<Response>

const CHECKED: TraceStep = { name: 'Request checked', status: 'ok', ms: 1, detail: 'Describe, image/png, about 1 KB' }
const NEWEST = 'anthropic/claude-haiku-5.5'
const OTHER = 'test/other-model'
const REQUESTED = '~anthropic/claude-haiku-latest'
const encoder = new TextEncoder()

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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

// A stream that names a model, sends no words, and then drops: the run retries once.
function droppedReply(served: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ model: served, choices: [{ delta: {} }] })}\n\n`))
    },
    pull(controller) {
      controller.error(new TypeError('socket closed'))
    },
  })
  return new Response(body, { status: 200 })
}

async function framesOf(response: Response): Promise<Record<string, unknown>[]> {
  const raw = await response.text()
  const blocks = raw.split('\n\n').filter(block => block !== '')
  expect(blocks.at(-1)).toBe('data: [DONE]')
  return blocks.slice(0, -1).map(block => JSON.parse(block.slice('data: '.length)) as Record<string, unknown>)
}

describe('streamVisionRun newest-model check', () => {
  it('never puts the requested alias in place of a served model the reply does not name', async () => {
    stubFetch(async () => sseReply([{ choices: [{ delta: { content: 'A sign.' }, finish_reason: 'stop' }] }]))

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames.at(-1)).toMatchObject({
      stage: 'complete',
      servedModel: null,
      newestModel: NEWEST,
      modelCheck: 'not-reported',
      mismatchedModel: null,
    })
    expect(frames.at(-1)?.servedModel).not.toBe(REQUESTED)
  })

  it('names a served model that is not the newest, and logs the mismatch with the requested alias', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    stubFetch(async () => sseReply([{ model: OTHER, choices: [{ delta: { content: 'A sign.' }, finish_reason: 'stop' }] }]))

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames.at(-1)).toMatchObject({
      stage: 'complete',
      servedModel: OTHER,
      newestModel: NEWEST,
      modelCheck: 'mismatch',
      mismatchedModel: OTHER,
    })
    expect(warn).toHaveBeenCalledWith(`model mismatch: served ${OTHER}, newest ${NEWEST}, requested ${REQUESTED}`)
  })

  it('reports unchecked, with no newest model invented, when the list gives none', async () => {
    stubFetch(async () => sseReply([{ model: NEWEST, choices: [{ delta: { content: 'A sign.' }, finish_reason: 'stop' }] }]))

    const frames = await framesOf(streamVisionRun(makeRun({ newest: () => Promise.resolve(null) })))

    expect(frames.at(-1)).toMatchObject({ stage: 'complete', servedModel: NEWEST, newestModel: null, modelCheck: 'unchecked' })
  })

  it('shows the worst check across calls: a mismatch on the first call and a match on the retry that answers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let calls = 0
    const provider = stubFetch(async () =>
      ++calls === 1 ? droppedReply(OTHER) : sseReply([{ model: NEWEST, choices: [{ delta: { content: 'A sign.' }, finish_reason: 'stop' }] }]),
    )

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(provider).toHaveBeenCalledTimes(2)
    expect(frames.at(-1)).toMatchObject({
      stage: 'complete',
      result: 'A sign.',
      servedModel: NEWEST,
      newestModel: NEWEST,
      modelCheck: 'mismatch',
      mismatchedModel: OTHER,
    })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('leaves out a try that got headers but no words, so its silence does not hide the retry match', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let calls = 0
    // Headers arrive, then nothing: the first try hangs until the 9-second limit and the run retries once.
    stubFetch(async () =>
      ++calls === 1
        ? new Response(new ReadableStream<Uint8Array>(), { status: 200 })
        : sseReply([{ model: NEWEST, choices: [{ delta: { content: 'A sign.' }, finish_reason: 'stop' }] }]),
    )

    const done = framesOf(streamVisionRun(makeRun()))
    await vi.advanceTimersByTimeAsync(FIRST_TEXT_LIMIT_MS + 100)
    const frames = await done

    expect(calls).toBe(2)
    expect(frames.at(-1)).toMatchObject({ stage: 'complete', result: 'A sign.', servedModel: NEWEST, modelCheck: 'match' })
  })

  it('reports not-reported when no provider answer arrived at all', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })

    const frames = await framesOf(streamVisionRun(makeRun()))

    expect(frames.at(-1)).toMatchObject({ stage: 'failed', servedModel: null, newestModel: NEWEST, modelCheck: 'not-reported' })
  })
})
