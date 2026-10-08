import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { providerFetch } from '../helpers/fake-openrouter'
import { untilSettled } from '../helpers/fake-time'
import { getFrom, postJson, readFrames, typesOf, parseFrames, type Frame } from '../helpers/http'

vi.mock('@netlify/blobs', async () => (await import('../helpers/fake-blobs')).fakeBlobsModule())

import start from '../../netlify/functions/start'

const SMALL = 'Order ORD-1077 arrived with a dead wheel on the mouse, please refund that item.'
const LARGE = 'I was charged twice for ORD-1042. Both charges were $129.00, please refund the extra one.'
const PROVIDER_REJECTED = 'The AI provider rejected the key or is out of credit.'
const PROVIDER_SLOW = 'The AI provider did not answer in time.'

function find(frames: Frame[], type: string): Record<string, unknown> | undefined {
  return frames.find((frame): frame is Record<string, unknown> => frame !== '[DONE]' && frame.type === type)
}

function nodeEnds(frames: Frame[]): Array<[unknown, unknown]> {
  return frames
    .filter((frame): frame is Record<string, unknown> => frame !== '[DONE]' && frame.type === 'node_end')
    .map((frame) => [frame.node, frame.status])
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
})

afterEach(() => {
  process.env.OPENROUTER_API_KEY = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('POST /api/start', () => {
  it('streams a small refund: node frames in order, a result with real values, then [DONE]', async () => {
    const fetchStub = providerFetch()
    vi.stubGlobal('fetch', fetchStub)

    const response = await start(postJson('/api/start', { ticket: SMALL }, 'ip-start-1'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const frames = await readFrames(response)
    expect(typesOf(frames)[0]).toBe('thread')
    expect(typesOf(frames).at(-1)).toBe('[DONE]')
    expect(find(frames, 'thread')?.threadId).toMatch(/^[0-9a-f-]{36}$/)
    expect(nodeEnds(frames)).toEqual([
      ['intake', 'ok'],
      ['policy', 'ok'],
      ['decide', 'ok'],
      ['review', 'skipped'],
      ['reply', 'ok'],
    ])
    expect(find(frames, 'result')?.result).toMatchObject({
      action: 'refund',
      amount: 24.5,
      reply: { subject: 'Your refund for ORD-1077', body: 'Dear customer, we have reviewed your ticket.' },
      totals: { costSource: 'estimated', models: ['xiaomi/mimo-v2.6-flash', '~anthropic/claude-haiku-latest'] },
    })
    expect(fetchStub).toHaveBeenCalledTimes(3)
  })

  it('pauses a large refund at review: an interrupt frame carries the proposal and there is no result', async () => {
    vi.stubGlobal('fetch', providerFetch())

    const frames = await readFrames(await start(postJson('/api/start', { ticket: LARGE }, 'ip-start-2')))

    expect(nodeEnds(frames)).toEqual([
      ['intake', 'ok'],
      ['policy', 'ok'],
      ['decide', 'ok'],
    ])
    expect(find(frames, 'edge')).toBeDefined()
    expect(frames).toContainEqual({ type: 'edge', from: 'decide', to: 'review', label: 'requiresHuman' })
    expect(find(frames, 'result')).toBeUndefined()
    expect(find(frames, 'interrupt')).toMatchObject({
      type: 'interrupt',
      node: 'review',
      threadId: find(frames, 'thread')?.threadId,
      payload: {
        proposal: { action: 'refund', amount: 129 },
        policy: { requiresHuman: true },
        orderId: 'ORD-1042',
        orderTotal: 129,
      },
    })
    expect(typesOf(frames).at(-1)).toBe('[DONE]')
  })

  it('refuses a ticket outside 10 to 2,000 characters with a plain 400, before any model call', async () => {
    const fetchStub = providerFetch()
    vi.stubGlobal('fetch', fetchStub)

    const response = await start(postJson('/api/start', { ticket: 'too short' }, 'ip-start-3'))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ success: false, error: 'The ticket must be 10 to 2,000 characters.' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('answers 405 to a GET, and calls nothing', async () => {
    const fetchStub = providerFetch()
    vi.stubGlobal('fetch', fetchStub)

    const response = await start(getFrom('/api/start', 'ip-start-4'))

    expect(response.status).toBe(405)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('answers 503 when no key is configured, before any model call', async () => {
    process.env.OPENROUTER_API_KEY = ''
    const fetchStub = providerFetch()
    vi.stubGlobal('fetch', fetchStub)

    const response = await start(postJson('/api/start', { ticket: SMALL }, 'ip-start-5'))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ success: false, error: 'The AI provider is not configured.' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('maps a provider 402 to the plain message inside an error frame, without the provider body', async () => {
    vi.stubGlobal('fetch', providerFetch({ status: 402 }))

    const response = await start(postJson('/api/start', { ticket: SMALL }, 'ip-start-6'))
    const text = await response.text()
    const frames = parseFrames(text)

    expect(response.status).toBe(200)
    expect(find(frames, 'error')).toEqual({ type: 'error', message: PROVIDER_REJECTED })
    expect(nodeEnds(frames)).toEqual([['intake', 'failed']])
    expect(frames[frames.length - 1]).toBe('[DONE]')
    expect(text).not.toContain('raw provider text')
  })

  it('maps a provider 500 to the did-not-answer message inside an error frame', async () => {
    vi.stubGlobal('fetch', providerFetch({ status: 500 }))

    const frames = await readFrames(await start(postJson('/api/start', { ticket: SMALL }, 'ip-start-8')))

    expect(find(frames, 'error')).toEqual({ type: 'error', message: PROVIDER_SLOW })
    expect(typesOf(frames).at(-1)).toBe('[DONE]')
  })

  it('maps a model call that never answers to the did-not-answer message after 20 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      ),
    )

    const response = await start(postJson('/api/start', { ticket: SMALL }, 'ip-start-7'))
    const frames = parseFrames(await untilSettled(response.text()))

    expect(find(frames, 'error')).toEqual({ type: 'error', message: PROVIDER_SLOW })
    expect(frames[frames.length - 1]).toBe('[DONE]')
  })
})
