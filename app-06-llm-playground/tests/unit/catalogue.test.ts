import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../helpers'

function model(id: string, name: string, contextLength: number, prompt: string, completion: string, outputs: string[]) {
  return {
    id,
    name,
    context_length: contextLength,
    pricing: { prompt, completion },
    architecture: { output_modalities: outputs },
  }
}

const LIVE = {
  data: [
    model('google/gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite', 1_000_000, '0.0000001', '0.0000005', ['text']),
    model('anthropic/claude-sonnet-5', 'Claude Sonnet 5', 200_000, '0.000003', '0.000015', ['text']),
    model('vendor/big-text', 'Big Text', 128_000, '0.000001', '0.000002', ['text']),
    model('vendor/small-context', 'Small', 8_000, '0.000001', '0.000002', ['text']),
    model('vendor/image-only', 'Image', 128_000, '0.000001', '0.000002', ['image']),
    model('vendor/free-variant:free', 'Free', 128_000, '0', '0', ['text']),
    model('openrouter/auto', 'Router', 2_000_000, '-1', '-1', ['text']),
  ],
}

// A fresh module per test, so the snapshot and retry state never carry over.
async function fresh() {
  vi.resetModules()
  return import('../../netlify/shared/catalogue')
}

const CURATED_LABELS = ['Speed and latency', 'Reasoning', 'Agentic and coding', 'Price and value', 'Frontier quality']

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('live catalogue', () => {
  it('keeps the curated picks that the live list still offers, with live prices', async () => {
    const stub = stubFetch(async () => Response.json(LIVE))
    const cat = await fresh()
    const view = await cat.catalogueView()
    expect(stub).toHaveBeenCalledTimes(1)
    expect(view).toMatchObject({ source: 'live', defaultModel: '~anthropic/claude-haiku-latest' })
    expect(view.groups.map(g => g.label)).toEqual(['Speed and latency', 'Frontier quality', 'All other live text models'])
    const speed = view.groups[0]
    expect(speed.options).toEqual([
      {
        id: 'google/gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash Lite',
        why: 'low cost, quick',
        inPerM: 0.1,
        outPerM: 0.5,
        contextLength: 1_000_000,
      },
    ])
    expect(view.groups[1].options[0]).toMatchObject({ id: 'anthropic/claude-sonnet-5', inPerM: 3, outPerM: 15 })
  })

  it('lists other live text models outside the curated groups, dropping free, router and short-context ones', async () => {
    const stub = stubFetch(async () => Response.json(LIVE))
    const view = await (await fresh()).catalogueView()
    expect(stub).toHaveBeenCalledTimes(1)
    const other = view.groups.find(g => g.label === 'All other live text models')
    expect(other?.options.map(o => o.id)).toEqual(['vendor/big-text'])
  })

  it('accepts exactly the IDs the picker offers, so compare cannot run a model the picker hides', async () => {
    const stub = stubFetch(async () => Response.json(LIVE))
    const cat = await fresh()
    const view = await cat.catalogueView()
    const offered = view.groups.flatMap(g => g.options.map(o => o.id)).sort()
    const accepted = cat.acceptedIds(await cat.liveModels())
    expect(stub).toHaveBeenCalledTimes(1)
    expect([...accepted].sort()).toEqual(offered)
    expect([...accepted].sort()).toEqual(['anthropic/claude-sonnet-5', 'google/gemini-2.5-flash-lite', 'vendor/big-text'])
  })

  it('refuses the models the picker hides: free and batch variants, short-context models, routers and image-only models', async () => {
    stubFetch(async () => Response.json(LIVE))
    const cat = await fresh()
    const accepted = cat.acceptedIds(await cat.liveModels())
    expect(accepted.has('vendor/free-variant:free')).toBe(false)
    expect(accepted.has('vendor/small-context')).toBe(false)
    expect(accepted.has('openrouter/auto')).toBe(false)
    expect(accepted.has('vendor/image-only')).toBe(false)
    expect(accepted.has('openai/gpt-5.4-nano')).toBe(false)
  })

  it('serves a cached catalogue with no second request until the ten-minute TTL passes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
    const stub = stubFetch(async () => Response.json(LIVE))
    const cat = await fresh()
    await cat.catalogueView()
    await cat.catalogueView()
    expect(stub).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-10-08T12:10:01Z'))
    await cat.catalogueView()
    expect(stub).toHaveBeenCalledTimes(2)
  })

  it('serves the last good copy, labelled cached, while refreshes fail after the TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let outage = false
    const stub = stubFetch(async () => (outage ? new Response('down', { status: 500 }) : Response.json(LIVE)))
    const cat = await fresh()
    expect((await cat.catalogueView()).source).toBe('live')
    outage = true
    vi.setSystemTime(new Date('2026-10-08T12:10:01Z'))
    const stale = await cat.catalogueView()
    expect(stub).toHaveBeenCalledTimes(2)
    expect(stale).toMatchObject({ source: 'cached', fetchedAt: '2026-10-08T12:00:00.000Z' })
    expect(stale.groups[0].options[0].id).toBe('google/gemini-2.5-flash-lite')
    expect(cat.acceptedIds(await cat.liveModels()).has('google/gemini-2.5-flash-lite')).toBe(true)
  })
})

describe('fallback catalogue', () => {
  it('serves the curated list, with no prices, when the catalogue answers with an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = stubFetch(async () => new Response('{"error":"down"}', { status: 500 }))
    const cat = await fresh()
    const view = await cat.catalogueView()
    expect(stub).toHaveBeenCalledTimes(1)
    expect(view.source).toBe('fallback')
    expect(view.fetchedAt).toBeNull()
    expect(view.groups.map(g => g.label)).toEqual(CURATED_LABELS)
    expect(view.groups[0].options[0]).toEqual({
      id: 'google/gemini-3.1-flash-lite',
      label: 'google/gemini-3.1-flash-lite',
      why: 'small and fast, long context',
      inPerM: null,
      outPerM: null,
      contextLength: null,
    })
    expect(cat.acceptedIds(null).size).toBe(23)
  })

  it('serves the curated list when the catalogue does not answer in time', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = stubFetch(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    })
    const view = await (await fresh()).catalogueView()
    expect(stub).toHaveBeenCalledTimes(1)
    expect(view).toMatchObject({ source: 'fallback', fetchedAt: null })
  })

  it('makes no new request during the one-minute retry window after a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const cat = await fresh()
    await cat.catalogueView()
    await cat.catalogueView()
    expect(stub).toHaveBeenCalledTimes(1)
  })
})
