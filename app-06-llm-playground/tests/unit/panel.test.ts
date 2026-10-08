import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPARE_MAX_TOKENS, type PanelResult } from '../../netlify/shared/contract'
import { failedPanel, PANEL_TIMEOUT_MS, panelStep, runPanel } from '../../netlify/shared/panel'
import { stubFetch, TEST_KEY } from '../helpers'

const input = {
  key: TEST_KEY,
  slot: 'B' as const,
  model: 'vendor/requested',
  prompt: 'Say READY',
  prices: null,
  timeoutMs: 5_000,
}

interface SentBody {
  model: string
  messages: { role: string; content: string }[]
  max_tokens: number
  temperature?: number
}

function sentBody(stub: { mock: { calls: [string, RequestInit?][] } }, call = 0): SentBody {
  return JSON.parse(String(stub.mock.calls[call][1]?.body)) as SentBody
}

describe('runPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the answer, the served model, the usage and the reported cost', async () => {
    const stub = stubFetch(async () =>
      Response.json({
        model: 'vendor/served-v2',
        choices: [{ message: { content: 'READY' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 200,
          total_tokens: 1200,
          cost: 0.0003,
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      }),
    )
    const panel = await runPanel(input)
    expect(panel).toMatchObject({
      slot: 'B',
      requestedModel: 'vendor/requested',
      servedModel: 'vendor/served-v2',
      ok: true,
      error: null,
      text: 'READY',
      finishReason: 'stop',
      cost: { usd: 0.0003, source: 'usage' },
    })
    expect(panel.usage).toEqual({ prompt_tokens: 1000, completion_tokens: 200, reasoning_tokens: 0, total_tokens: 1200 })
    expect(typeof panel.latencyMs).toBe('number')
    expect(sentBody(stub)).toMatchObject({
      model: 'vendor/requested',
      max_tokens: COMPARE_MAX_TOKENS,
      messages: [{ role: 'user', content: 'Say READY' }],
    })
  })

  it('puts the system prompt first and sends the temperature when they are given', async () => {
    const stub = stubFetch(async () =>
      Response.json({ model: 'vendor/requested', choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }),
    )
    await runPanel({ ...input, system: 'Be brief.', temperature: 0.3 })
    expect(stub).toHaveBeenCalledTimes(1)
    expect(sentBody(stub).messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Say READY' },
    ])
    expect(sentBody(stub).temperature).toBe(0.3)
  })

  it('fails a reply cut off at the token cap, and names the cap', async () => {
    const stub = stubFetch(async () =>
      Response.json({ model: 'vendor/requested', choices: [{ message: { content: '' }, finish_reason: 'length' }] }),
    )
    expect(await runPanel(input)).toMatchObject({
      ok: false,
      error: 'Hit the 2048-token limit before any answer text',
    })
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('fails a reply that contains only spaces', async () => {
    const stub = stubFetch(async () =>
      Response.json({ model: 'vendor/requested', choices: [{ message: { content: '   ' }, finish_reason: 'stop' }] }),
    )
    expect(await runPanel(input)).toMatchObject({ ok: false, error: 'The model returned no text' })
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('maps a provider failure to the panel, with no usage and no cost', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = stubFetch(async () => new Response('{"error":"no credit"}', { status: 402 }))
    const panel = await runPanel(input)
    expect(stub).toHaveBeenCalledTimes(1)
    expect(panel).toMatchObject({
      slot: 'B',
      requestedModel: 'vendor/requested',
      servedModel: null,
      ok: false,
      error: 'The AI provider rejected the key or is out of credit',
      text: '',
      finishReason: null,
      cost: null,
    })
    expect(panel.usage).toEqual({ prompt_tokens: null, completion_tokens: null, reasoning_tokens: null, total_tokens: null })
  })
})

const served: PanelResult = {
  slot: 'B',
  requestedModel: 'vendor/requested',
  servedModel: 'vendor/served-v2',
  ok: true,
  error: null,
  text: 'READY',
  finishReason: 'stop',
  latencyMs: 812,
  usage: { prompt_tokens: 1000, completion_tokens: 200, reasoning_tokens: 0, total_tokens: 1200 },
  cost: { usd: 0.0003, source: 'usage' },
}

describe('panelStep', () => {
  it('describes a served answer with its measured numbers', () => {
    expect(panelStep(served)).toEqual({
      name: 'Panel B request',
      status: 'ok',
      ms: 812,
      detail: 'Served by vendor/served-v2, 200 output tokens',
      tokens: 1200,
      cost: { usd: 0.0003, source: 'usage' },
    })
  })

  it('says when the provider did not report output tokens', () => {
    const step = panelStep({ ...served, usage: { ...served.usage, completion_tokens: null } })
    expect(step.detail).toBe('Served by vendor/served-v2, output tokens not reported')
  })

  it('marks a failed panel with its plain-language error', () => {
    const step = panelStep({ ...served, ok: false, error: 'Rate limited, try again in a minute', servedModel: null })
    expect(step).toMatchObject({ name: 'Panel B request', status: 'failed', detail: 'Rate limited, try again in a minute' })
  })
})

describe('failedPanel', () => {
  it('builds an empty failed panel that has no latency, usage or cost', () => {
    expect(failedPanel('C', 'vendor/x')).toEqual({
      slot: 'C',
      requestedModel: 'vendor/x',
      servedModel: null,
      ok: false,
      error: 'The panel stopped unexpectedly',
      text: '',
      finishReason: null,
      latencyMs: null,
      usage: { prompt_tokens: null, completion_tokens: null, reasoning_tokens: null, total_tokens: null },
      cost: null,
    })
  })

  it('gives each panel a 25 second timeout', () => {
    expect(PANEL_TIMEOUT_MS).toBe(25_000)
  })
})
