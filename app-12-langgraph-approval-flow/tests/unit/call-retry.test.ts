import { describe, expect, it, vi } from 'vitest'
import { GraphGateSaver } from '../../netlify/shared/blobs-saver'
import { buildGraph } from '../../netlify/shared/graph'
import { MODEL } from '../../netlify/shared/models'
import { CALL_TIMEOUT_MS, PROVIDER_REJECTED, PROVIDER_SLOW, PROVIDER_TIMEOUT, PROVIDER_UNREACHABLE, ProviderError, type ChatFn } from '../../netlify/shared/openrouter'
import { createMemoryStore } from '../../netlify/shared/store'
import type { TraceRow } from '../../src/types'
import { classificationText, providerResult } from '../helpers/fake-chat'
import { QUESTION } from '../helpers/issues'

const timeout = () => new ProviderError(504, PROVIDER_TIMEOUT, 'timeout')

/** A chat that plays `script` call by call: an Error is thrown, text is returned. Classify and reply texts follow the prompts. */
function scripted(script: Array<Error | 'ok'>) {
  let call = 0
  return vi.fn<ChatFn>(async (request) => {
    const step = script[call++] ?? 'ok'
    if (step instanceof Error) throw step
    const isClassify = request.messages[0].content.includes('You sort one public GitHub issue')
    return providerResult(isClassify ? classificationText(undefined) : 'Thanks for the report.', MODEL)
  })
}

async function run(chat: ChatFn, remainingMs = () => 25_000) {
  const graph = buildGraph({ chat, now: () => new Date(), remainingMs, checkpointer: new GraphGateSaver(createMemoryStore()) })
  const config = { configurable: { thread_id: 't' } }
  const outcome = await graph.invoke({ issue: QUESTION }, config).then(
    () => null,
    (err: unknown) => err,
  )
  return { outcome, trace: ((await graph.getState(config)).values.trace ?? []) as TraceRow[] }
}

describe('one automatic retry of a hung or disconnected model call', () => {
  it('uses an 8 second call limit', () => {
    expect(CALL_TIMEOUT_MS).toBe(8_000)
  })

  it('retries a hung classify call once and records it in the trace', async () => {
    const chat = scripted([timeout()])
    const { outcome, trace } = await run(chat)
    expect(outcome).toBeNull()
    expect(chat).toHaveBeenCalledTimes(3)
    expect(trace[0]).toMatchObject({ node: 'classify', status: 'ok', detail: expect.stringMatching(/^Retried once after 8 s timeout\. Read as question/) })
    expect(trace[2].detail).not.toContain('Retried')
  })

  it('retries a hung reply call once too', async () => {
    const chat = scripted(['ok', timeout()])
    const { outcome, trace } = await run(chat)
    expect(outcome).toBeNull()
    expect(chat).toHaveBeenCalledTimes(3)
    expect(trace.find((row) => row.node === 'reply')?.detail).toMatch(/^Retried once after 8 s timeout\./)
  })

  it('retries a lost connection once', async () => {
    const chat = scripted([new ProviderError(0, PROVIDER_UNREACHABLE)])
    const { outcome, trace } = await run(chat)
    expect(outcome).toBeNull()
    expect(trace[0].detail).toMatch(/^Retried once after connection failure\./)
  })

  it('fails with a message that says the retry also hung when the second call hangs too', async () => {
    const chat = scripted([timeout(), timeout()])
    const { outcome, trace } = await run(chat)
    expect(outcome).toMatchObject({ kind: 'timeout', retried: true })
    expect(chat).toHaveBeenCalledTimes(2)
    // Nothing finished, so the checkpoint has no trace rows: the failed step is reported live.
    expect(trace).toEqual([])
  })

  it.each([
    ['a rejected key', new ProviderError(401, PROVIDER_REJECTED)],
    ['a 4xx request error', new ProviderError(400, 'The AI provider rejected the request.')],
    ['a rate limit', new ProviderError(429, 'Rate limited, try again in a minute.')],
    ['a server error', new ProviderError(500, PROVIDER_SLOW)],
    ['a budget stop', new ProviderError(504, PROVIDER_SLOW, 'budget')],
  ])('never retries %s', async (_name, failure) => {
    const chat = scripted([failure])
    const { outcome } = await run(chat)
    expect(outcome).toBe(failure)
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('does not retry when the budget has no room for the retry and the reply call still to come', async () => {
    // 8 s for the retry + 3 s each for the duplicate check and the reply + 1 s margin = 15 s needed.
    const chat = scripted([timeout()])
    const { outcome } = await run(chat, () => 14_999)
    expect(outcome).toMatchObject({ kind: 'timeout' })
    expect(outcome).toMatchObject({ retried: false })
    expect(chat).toHaveBeenCalledTimes(1)

    const roomy = scripted([timeout()])
    expect((await run(roomy, () => 15_000)).outcome).toBeNull()
    expect(roomy).toHaveBeenCalledTimes(3)
  })

  it('needs less room for the last model call, since nothing follows it', async () => {
    const chat = scripted(['ok', timeout()])
    // 8 s for the retry + 0 + 1 s margin = 9 s.
    expect((await run(chat, () => 9_000)).outcome).toBeNull()
    const tight = scripted(['ok', timeout()])
    expect((await run(tight, () => 8_999)).outcome).toMatchObject({ kind: 'timeout' })
  })
})
