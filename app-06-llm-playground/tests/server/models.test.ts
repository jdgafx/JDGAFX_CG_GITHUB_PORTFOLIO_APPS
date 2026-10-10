import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogueResponse } from '../../netlify/shared/contract'
import { stubFetch } from '../helpers'
import { LIVE_CATALOGUE, request } from './fixtures'

const URL = 'http://localhost:8888/api/models'
const CURATED = ['Speed and latency', 'Reasoning', 'Agentic and coding', 'Price and value', 'Frontier quality']

async function handler() {
  vi.resetModules()
  return (await import('../../netlify/functions/models')).default
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('models function', () => {
  it('returns the live catalogue grouped by speed, agentic use and price, with live prices', async () => {
    const stub = stubFetch(async () => Response.json(LIVE_CATALOGUE))
    const response = await (await handler())(request(URL, 'GET'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as CatalogueResponse
    expect(body).toMatchObject({ source: 'live', defaultModel: '~anthropic/claude-haiku-latest' })
    expect(body.groups.map(g => g.label)).toEqual(['Speed and latency', 'Frontier quality'])
    expect(body.groups[0].options).toEqual([
      {
        id: 'google/gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash Lite',
        why: 'low cost, quick',
        inPerM: 0.1,
        outPerM: 0.5,
        contextLength: 1_000_000,
      },
    ])
    expect(stub).toHaveBeenCalledTimes(1)
    const [url, init] = stub.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/models')
    expect(init?.signal).toBeDefined()
    expect(init?.headers).toBeUndefined()
  })

  it('serves the curated list with source fallback when the catalogue answers with an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = stubFetch(async () => new Response('down', { status: 500 }))
    const response = await (await handler())(request(URL, 'GET'))
    expect(stub).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    const body = (await response.json()) as CatalogueResponse
    expect(body).toMatchObject({ source: 'fallback', fetchedAt: null })
    expect(body.groups.map(g => g.label)).toEqual(CURATED)
  })

  it('serves the curated list with source fallback when the catalogue does not answer in time', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = stubFetch(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    })
    const response = await (await handler())(request(URL, 'GET'))
    expect(stub).toHaveBeenCalledTimes(1)
    const body = (await response.json()) as CatalogueResponse
    expect(body).toMatchObject({ source: 'fallback', fetchedAt: null })
    expect(body.groups.map(g => g.label)).toEqual(CURATED)
  })

  it('answers a POST with 405 and reads nothing', async () => {
    const stub = stubFetch(async () => Response.json(LIVE_CATALOGUE))
    const response = await (await handler())(request(URL, 'POST', {}))
    expect(response.status).toBe(405)
    expect(await response.json()).toEqual({ error: 'Method not allowed' })
    expect(stub).not.toHaveBeenCalled()
  })
})
