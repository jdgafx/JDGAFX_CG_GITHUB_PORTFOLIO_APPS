import { describe, it, expect, vi } from 'vitest'
import handler from '../../netlify/functions/ai'
import { chatBody, finalFrame, installProviderStub, jsonReply, request, runOf, stubProvider, VALID } from './helpers'

installProviderStub()

// Every reply from chatBody is billed 150 tokens and $0.00012.
const CALL = { total_tokens: 150, cost: 0.00012 }
const ROW = { tokens: 150, cost: 0.00012 }
const GOOD = '{"answer":"Opened in 1987 [Chunk 3].","source_chunk_indices":[3],"confidence":0.9}'
const CUT_OFF = 'The AI reply was cut off before the answer finished. Try a narrower question.'
const timeout = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' })

/** The first fetch throws `first`, and every later one takes the next reply. */
function failThen(first: Error, ...replies: Array<() => Response>) {
  let calls = 0
  const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    calls += 1
    if (calls === 1) throw first
    const next = replies.shift()
    if (!next) throw timeout()
    return next()
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('billed usage: a failed run keeps what was spent', () => {
  it('counts both calls when the retry is cut off, in the totals and in each row', async () => {
    stubProvider(
      () => jsonReply(chatBody('{"answer":"The Harbor', { finish: 'length' })),
      () => jsonReply(chatBody(GOOD, { finish: 'length' })),
    )
    const last = await finalFrame(await handler(request(VALID)))
    expect(last).toMatchObject({ type: 'error', error: CUT_OFF })
    expect(last.usage).toMatchObject({ total_tokens: 300, cost: 0.00024, cost_source: 'reported', not_reported: 0 })
    expect(last.trace?.filter(step => step.name.includes('model call') || step.name === 'Call model')).toMatchObject([
      { name: 'Call model', tokens: 150, cost: 0.00012 },
      { name: 'Retry model call', tokens: 150, cost: 0.00012 },
    ])
  })

  it('counts both calls when both replies are empty', async () => {
    stubProvider(() => jsonReply(chatBody('', { finish: 'stop' })), () => jsonReply(chatBody('  ', { finish: 'stop' })))
    const last = await finalFrame(await handler(request(VALID)))
    expect(last.type).toBe('error')
    expect(last.usage).toMatchObject({ total_tokens: 300, cost: 0.00024, not_reported: 0 })
  })

  it('counts the call when its reply is not valid JSON', async () => {
    stubProvider(() => jsonReply(chatBody('not json at all')))
    const last = await finalFrame(await handler(request(VALID)))
    expect(last).toMatchObject({ type: 'error', error: 'The model returned a malformed response. Please try again.' })
    expect(last.usage).toMatchObject({ ...CALL, not_reported: 0 })
    expect(last.trace?.find(step => step.name === 'Call model')).toMatchObject(ROW)
  })

  it('counts the call when the reply is cut off and there is no time to ask again', async () => {
    let skew = 0
    const real = Date.now.bind(Date)
    vi.spyOn(Date, 'now').mockImplementation(() => real() + skew)
    // The reply arrives 21 s into the 25 s deadline, which leaves under the 5 s a retry needs.
    const mock = stubProvider(() => {
      skew = 21_000
      return jsonReply(chatBody('{"answer":"The Harbor', { finish: 'length' }))
    })
    const last = await finalFrame(await handler(request(VALID)))
    expect(mock).toHaveBeenCalledTimes(1)
    expect(last).toMatchObject({ type: 'error', error: 'The AI provider did not answer in time.' })
    expect(last.usage).toMatchObject({ ...CALL, not_reported: 0 })
    expect(last.trace?.find(step => step.name === 'Call model')).toMatchObject({ status: 'failed', ...ROW })
  })

  it('marks a timed-out first call as not reported and counts the retry that was cut off', async () => {
    failThen(timeout(), () => jsonReply(chatBody(GOOD, { finish: 'length' })))
    const last = await finalFrame(await handler(request(VALID)))
    expect(last).toMatchObject({ type: 'error', error: CUT_OFF })
    expect(last.usage).toMatchObject({ ...CALL, not_reported: 1 })
    expect(last.trace?.find(step => step.name === 'Call model')).toMatchObject({ status: 'failed', tokens: null, cost: null })
    expect(last.trace?.find(step => step.name === 'Retry model call')).toMatchObject(ROW)
  })

  it('counts a cut-off first call and marks the retry that timed out as not reported', async () => {
    stubProvider(
      () => jsonReply(chatBody('{"answer":"The Harbor', { finish: 'length' })),
      () => {
        throw timeout()
      },
    )
    const last = await finalFrame(await handler(request(VALID)))
    expect(last.type).toBe('error')
    expect(last.usage).toMatchObject({ ...CALL, not_reported: 1 })
    expect(last.trace?.find(step => step.name === 'Retry model call')).toMatchObject({ status: 'failed', tokens: null, cost: null })
  })

  it('reports no figures, and two calls not reported, when both calls time out', async () => {
    failThen(timeout())
    const last = await finalFrame(await handler(request(VALID)))
    expect(last.type).toBe('error')
    expect(last.usage).toMatchObject({ total_tokens: null, cost: null, cost_source: null, not_reported: 2 })
  })

  it('does not count a provider rejection, which carries no usage', async () => {
    stubProvider(() => jsonReply({ error: { message: 'no credit' } }, 402))
    const last = await finalFrame(await handler(request(VALID)))
    expect(last.usage).toMatchObject({ total_tokens: null, cost: null, not_reported: 0 })
    expect(last.trace?.find(step => step.name === 'Call model')?.tokens).toBeUndefined()
  })
})

describe('billed usage: a run that answers after a lost call is only a lower bound', () => {
  it('keeps the retry in the totals and marks the timed-out call as not reported', async () => {
    failThen(timeout(), () => jsonReply(chatBody(GOOD)))
    const run = await runOf(await handler(request(VALID)))
    expect(run.usage).toMatchObject({ ...CALL, cost_source: 'reported', not_reported: 1 })
    expect(run.trace.find(step => step.name === 'Call model')).toMatchObject({ tokens: null, cost: null })
  })

  it('reports zero not-reported calls when every call answered', async () => {
    stubProvider(() => jsonReply(chatBody(GOOD)))
    expect((await runOf(await handler(request(VALID)))).usage.not_reported).toBe(0)
  })
})
