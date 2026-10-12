import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompareResponse, JudgeResponse } from '../../netlify/shared/contract'
import { useTestKey } from '../helpers'
import { providerStub, reply, request } from './fixtures'

const COMPARE_URL = 'http://localhost:8888/api/compare'
const JUDGE_URL = 'http://localhost:8888/api/judge'
const MODELS = ['openai/ignored-by-server', 'google/gemini-2.5-flash-lite', 'anthropic/claude-sonnet-5']
const ANSWERS = [
  { slot: 'A', text: 'A long answer that is correct.' },
  { slot: 'B', text: 'A short answer that is correct.' },
]
const VERDICT = '{"bestOverall":"B","perPanel":{"A":"Correct but long.","B":"Correct and short."},"caveat":"One prompt, one sample."}'
const PAID = { prompt: 100, completion: 40, cost: 0.002 }
const timeout = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' })

async function compare(): Promise<CompareResponse> {
  vi.resetModules()
  const handler = (await import('../../netlify/functions/compare')).default
  return (await (await handler(request(COMPARE_URL, 'POST', { prompt: 'Say READY.', models: MODELS }))).json()) as CompareResponse
}

async function judge(): Promise<JudgeResponse> {
  vi.resetModules()
  const handler = (await import('../../netlify/functions/judge')).default
  return (await (await handler(request(JUDGE_URL, 'POST', { prompt: 'Q', answers: ANSWERS }))).json()) as JudgeResponse
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('billed usage: panels', () => {
  useTestKey()

  it('keeps the usage and cost of a cut-off panel and an empty panel in the response and in their trace rows', async () => {
    providerStub(model => {
      if (model === MODELS[1]) return reply(model, '', { ...PAID, finish: 'length' })
      if (model === MODELS[2]) return reply(model, '   ', PAID)
      return reply(model, 'READY', PAID)
    })
    const body = await compare()
    const [, cutOff, empty] = body.panels
    expect(cutOff).toMatchObject({ ok: false, finishReason: 'length', usage: { total_tokens: 140 }, cost: { usd: 0.002 }, notReported: 0 })
    expect(empty).toMatchObject({ ok: false, usage: { total_tokens: 140 }, cost: { usd: 0.002 }, notReported: 0 })
    expect(body.trace[1]).toMatchObject({ status: 'failed', tokens: 140, cost: { usd: 0.002 } })
    expect(body.trace[2]).toMatchObject({ status: 'failed', tokens: 140, cost: { usd: 0.002 } })
  })

  it("counts the lost first try of a retried panel as not reported, and keeps the second try's usage", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let calls = 0
    providerStub(model => {
      if (model === MODELS[1]) {
        calls += 1
        if (calls === 1) throw timeout()
      }
      return reply(model, 'READY', PAID)
    })
    const body = await compare()
    expect(body.panels[1]).toMatchObject({ ok: true, retried: true, notReported: 1, usage: { total_tokens: 140 }, cost: { usd: 0.002 } })
    expect(body.panels[0]).toMatchObject({ retried: false, notReported: 0 })
    expect(body.trace[1].detail).toContain('Usage not reported for 1 call')
  })

  it('counts a reply that carries no usage block as not reported', async () => {
    providerStub(model =>
      model === MODELS[1]
        ? Response.json({ model, choices: [{ message: { content: 'READY' }, finish_reason: 'stop' }] })
        : reply(model, 'READY', PAID),
    )
    const body = await compare()
    expect(body.panels[1]).toMatchObject({ ok: true, notReported: 1, cost: null })
  })

  it('does not count a provider refusal, which was never billed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    providerStub(model => (model === MODELS[1] ? new Response('{}', { status: 402 }) : reply(model, 'READY', PAID)))
    const body = await compare()
    expect(body.panels[1]).toMatchObject({ ok: false, notReported: 0 })
  })
})

describe('billed usage: judge', () => {
  useTestKey()

  it('carries the billed usage on a failure when the reply had no text', async () => {
    providerStub(model => reply(model, '   ', PAID))
    const body = await judge()
    expect(body).toMatchObject({
      ok: false,
      reason: 'The judge returned no text',
      usage: { total_tokens: 140 },
      cost: { usd: 0.002 },
      notReported: 0,
      trace: [{ name: 'Judge', status: 'failed', tokens: 140, cost: { usd: 0.002 } }],
    })
  })

  it('carries the billed usage on a failure when the reply has no verdict', async () => {
    providerStub(model => reply(model, 'Panel A is better.', PAID))
    const body = await judge()
    expect(body).toMatchObject({ ok: false, usage: { total_tokens: 140 }, cost: { usd: 0.002 }, trace: [{ tokens: 140, cost: { usd: 0.002 } }] })
  })

  it('counts a timed-out first try as not reported when the retry gives a verdict', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let calls = 0
    providerStub(model => {
      calls += 1
      if (calls === 1) throw timeout()
      return reply(model, VERDICT, PAID)
    })
    expect(await judge()).toMatchObject({ ok: true, notReported: 1, usage: { total_tokens: 140 }, cost: { usd: 0.002 } })
  })

  it('counts both tries as not reported when the judge times out twice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    providerStub(() => {
      throw timeout()
    })
    const body = await judge()
    expect(body).toMatchObject({ ok: false, notReported: 2 })
    expect(body).not.toHaveProperty('usage')
  })

  it('does not count a provider refusal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    providerStub(() => new Response('{}', { status: 402 }))
    expect(await judge()).toMatchObject({ ok: false, notReported: 0 })
  })
})
