import { describe, it, expect, vi } from 'vitest'
import handler from '../../netlify/functions/ai'
import {
  chatBody,
  finalFrame,
  installProviderStub,
  jsonReply,
  PLACEHOLDER_KEY,
  readFrames,
  request,
  runOf,
  sentBody,
  SERVED,
  stubProvider,
  upstream,
  useStub,
  VALID,
} from './helpers'

const CATALOGUE_URL = 'https://openrouter.ai/api/v1/models'

installProviderStub()

describe('ai function: happy path', () => {
  it('answers from the cited passage and reports the served model, tokens and cost', async () => {
    const mock = stubProvider(() =>
      jsonReply(chatBody('{"answer":"The Harbor Station was opened in 1987.","source_chunk_indices":[3],"confidence":0.95}')),
    )
    const res = await handler(request(VALID))
    expect(res.status).toBe(200)
    const body = await runOf(res)
    expect(body.result).toEqual({ answer: 'The Harbor Station was opened in 1987.', source_chunk_indices: [3], confidence: 0.95 })
    expect(body.model).toBe(SERVED)
    expect(body.usage).toMatchObject({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.00012, cost_source: 'reported' })
    expect(body.trace.map(step => [step.name, step.status])).toEqual([
      ['Accept request', 'ok'],
      ['Build prompt', 'ok'],
      ['Call model', 'ok'],
      ['Parse and validate', 'ok'],
    ])
    expect(body.trace[2]?.detail).toBe(`Response from ${SERVED}.`)
    expect(body.trace[3]?.detail).toBe('Answer cites 1 passage. Self-rated 95%.')
    expect(mock).toHaveBeenCalledTimes(1)
    expect(sentBody(mock, 0)).toMatchObject({ model: '~anthropic/claude-haiku-latest', max_tokens: 4096, usage: { include: true } })
    expect(mock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${PLACEHOLDER_KEY}` })
  })

  it('streams each step as it runs, then the result, then [DONE]', async () => {
    stubProvider(() => jsonReply(chatBody('{"answer":"Opened in 1987.","source_chunk_indices":[3],"confidence":0.9}')))
    const res = await handler(request(VALID))
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const { frames, lastLine } = await readFrames(res)
    expect(lastLine).toBe('[DONE]')
    expect(
      frames.map(frame => (frame.type === 'start' ? `start:${frame.name}` : frame.type === 'step' ? `step:${frame.step?.name}:${frame.step?.status}` : frame.type)),
    ).toEqual([
      'start:Accept request',
      'step:Accept request:ok',
      'start:Build prompt',
      'step:Build prompt:ok',
      'start:Call model',
      'step:Call model:ok',
      'start:Parse and validate',
      'step:Parse and validate:ok',
      'result',
    ])
    expect(frames.at(-1)?.run?.result.answer).toBe('Opened in 1987.')
    expect(frames.at(-1)?.run?.usage.total_tokens).toBe(150)
  })

  it('streams whatever the Accept header says, because the stream is the only reply', async () => {
    stubProvider(() => jsonReply(chatBody('{"answer":"1987.","source_chunk_indices":[3],"confidence":0.9}')))
    const res = await handler(request(VALID, { headers: { Accept: 'application/json' } }))
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect((await runOf(res)).result.answer).toBe('1987.')
  })

  it('estimates the cost from catalogue pricing when the provider reports none', async () => {
    const catalogue = { data: [{ id: SERVED, pricing: { prompt: '0.000001', completion: '0.000005' } }] }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === CATALOGUE_URL
          ? jsonReply(catalogue)
          : jsonReply(chatBody('{"answer":"1987.","source_chunk_indices":[3],"confidence":0.7}', { cost: false })),
      ),
    )
    const body = await runOf(await handler(request(VALID)))
    // 120 prompt tokens at 0.000001 plus 30 completion tokens at 0.000005.
    expect(body.usage).toMatchObject({ cost_source: 'estimated' })
    expect(body.usage.cost).toBeCloseTo(0.00027, 9)
    expect(body.trace[3]?.detail).toContain('Cost estimated from catalogue pricing.')
  })
})

describe('ai function: citations and self-rated confidence', () => {
  it('keeps only passages that were sent, once each, and clamps the rating to 100%', async () => {
    stubProvider(() => jsonReply(chatBody('{"answer":"Opened in 1987.","source_chunk_indices":[3,9,3],"confidence":1.4}')))
    const body = await runOf(await handler(request(VALID)))
    expect(body.result.source_chunk_indices).toEqual([3])
    expect(body.result.confidence).toBe(1)
    expect(body.trace[3]?.detail).toBe('Answer cites 1 passage. Self-rated 100%.')
  })
})

describe('ai function: retries', () => {
  it('asks again once when the first reply was cut off, and sums the tokens of both calls', async () => {
    const mock = stubProvider(
      () => jsonReply(chatBody('{"answer":"The Harbor', { finish: 'length' })),
      () => jsonReply(chatBody('{"answer":"1987.","source_chunk_indices":[3],"confidence":0.9}')),
    )
    const body = await runOf(await handler(request(VALID)))
    expect(mock).toHaveBeenCalledTimes(2)
    expect(body.result.answer).toBe('1987.')
    expect(body.usage.total_tokens).toBe(300)
    expect(body.trace.map(step => [step.name, step.status])).toEqual([
      ['Accept request', 'ok'],
      ['Build prompt', 'ok'],
      ['Call model', 'failed'],
      ['Retry model call', 'ok'],
      ['Parse and validate', 'ok'],
    ])
  })

  it('asks again when the reply is empty, even though the provider stopped cleanly', async () => {
    const mock = stubProvider(
      () => jsonReply(chatBody('', { finish: 'stop' })),
      () => jsonReply(chatBody('{"answer":"1987.","source_chunk_indices":[3],"confidence":0.9}')),
    )
    expect((await runOf(await handler(request(VALID)))).result.answer).toBe('1987.')
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('stops after one retry when both replies are empty', async () => {
    const mock = stubProvider(() => jsonReply(chatBody('', { finish: 'stop' })), () => jsonReply(chatBody('   ', { finish: 'stop' })))
    const last = await finalFrame(await handler(request(VALID)))
    expect(last).toMatchObject({ type: 'error', error: 'The model returned an empty response. Please try again.' })
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a provider error', async () => {
    const mock = stubProvider(() => jsonReply({ error: { message: 'Insufficient credits for acct_123' } }, 402))
    expect((await finalFrame(await handler(request(VALID)))).type).toBe('error')
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

describe('ai function: provider failures', () => {
  it('maps a provider 402 to its plain sentence and does not copy the provider body', async () => {
    stubProvider(() => jsonReply({ error: { message: 'Insufficient credits for acct_123' } }, 402))
    const res = await handler(request(VALID))
    const text = await res.text()
    const last = (await readFrames(new Response(text))).frames.at(-1)
    expect(last).toMatchObject({
      type: 'error',
      error: 'The AI provider rejected the key or is out of credit.',
      trace: [
        { name: 'Accept request', status: 'ok' },
        { name: 'Build prompt', status: 'ok' },
        { name: 'Call model', status: 'failed', detail: 'The AI provider rejected the key or is out of credit.' },
        { name: 'Parse and validate', status: 'skipped' },
      ],
    })
    expect(text).not.toContain('acct_123')
  })

  it('maps a provider 429 to the rate-limit sentence, and does not retry', async () => {
    const mock = stubProvider(() => jsonReply({ error: { message: 'Too many requests for acct_9' } }, 429))
    const res = await handler(request(VALID))
    const text = await res.text()
    expect((await readFrames(new Response(text))).frames.at(-1)).toMatchObject({
      type: 'error',
      error: 'Rate limited, try again in a minute.',
      trace: [
        { name: 'Accept request', status: 'ok' },
        { name: 'Build prompt', status: 'ok' },
        { name: 'Call model', status: 'failed', detail: 'Rate limited, try again in a minute.' },
        { name: 'Parse and validate', status: 'skipped' },
      ],
    })
    expect(text).not.toContain('acct_9')
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('maps a provider 500 to the did-not-answer sentence', async () => {
    stubProvider(() => new Response('upstream exploded', { status: 500 }))
    expect(await finalFrame(await handler(request(VALID)))).toMatchObject({
      type: 'error',
      error: 'The AI provider did not answer in time.',
    })
  })

  it('maps a timed-out provider call (AbortError) to the timeout sentence', async () => {
    const abort = new Error('The operation was aborted due to timeout')
    abort.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(abort)))
    expect(await finalFrame(await handler(request(VALID)))).toMatchObject({
      type: 'error',
      error: 'The AI provider did not answer in time.',
    })
  })

  it('reports a reply that is not a usable answer as an error frame with its own message', async () => {
    stubProvider(() => jsonReply(chatBody('not json at all')))
    expect(await finalFrame(await handler(request(VALID)))).toMatchObject({
      type: 'error',
      error: 'The model returned a malformed response. Please try again.',
    })
  })

  it('streams an error frame and then [DONE] when the provider refuses the call', async () => {
    stubProvider(() => jsonReply({ error: { message: 'Insufficient credits for acct_123' } }, 402))
    const res = await handler(request(VALID))
    expect(res.status).toBe(200)
    const { frames, lastLine } = await readFrames(res)
    expect(lastLine).toBe('[DONE]')
    const last = frames.at(-1)
    expect(last?.type).toBe('error')
    expect(last?.error).toBe('The AI provider rejected the key or is out of credit.')
    expect(typeof last?.totalMs).toBe('number')
    expect(last?.trace?.map(step => [step.name, step.status])).toEqual([
      ['Accept request', 'ok'],
      ['Build prompt', 'ok'],
      ['Call model', 'failed'],
      ['Parse and validate', 'skipped'],
    ])
    expect(JSON.stringify(frames)).not.toContain('acct_123')
  })
})

describe('ai function: client disconnects', () => {
  it('cancels the upstream call when the browser goes away', async () => {
    const client = new AbortController()
    const seen: { signal?: AbortSignal } = {}
    let markCalled: () => void = () => undefined
    const called = new Promise<void>(resolve => {
      markCalled = () => resolve()
    })
    // The stub never answers. It waits for the signal the handler gives it, and rejects when that signal aborts.
    const waiting = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal ?? undefined
          seen.signal = signal
          if (signal) signal.addEventListener('abort', () => reject(signal.reason))
          markCalled()
        }),
    )
    useStub(waiting)

    const pending = handler(request(VALID, { signal: client.signal }))
    await called
    client.abort()
    const res = await pending

    expect(res).toBeInstanceOf(Response)
    expect(waiting).toHaveBeenCalledTimes(1)
    expect(seen.signal?.aborted).toBe(true)
    expect(upstream()).toBe(waiting)
  })
})
