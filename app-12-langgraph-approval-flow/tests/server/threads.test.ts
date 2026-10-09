import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { providerFetch } from '../helpers/fake-openrouter'
import { getFrom, postJson, readFrames, type Frame } from '../helpers/http'
import { BUG, CLASSIFIED_BUG } from '../helpers/issues'

vi.mock('@netlify/blobs', async () => (await import('../helpers/fake-blobs')).fakeBlobsModule())

import start from '../../netlify/functions/start'
import threads from '../../netlify/functions/threads'

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
})

afterEach(() => {
  process.env.OPENROUTER_API_KEY = ''
  vi.unstubAllGlobals()
})

describe('GET /api/threads', () => {
  it('lists a waiting thread with its status, priority and a short title', async () => {
    vi.stubGlobal('fetch', providerFetch({ classification: CLASSIFIED_BUG }))
    const frames: Frame[] = await readFrames(await start(postJson('/api/start', { issue: BUG }, 'ip-threads-1')))
    const thread = frames.find((frame): frame is Record<string, unknown> => frame !== '[DONE]' && frame.type === 'thread')
    const threadId = thread?.threadId

    const response = await threads(getFrom('/api/threads', 'ip-threads-1'))
    const body = (await response.json()) as {
      success: boolean
      storage: string
      notice: string | null
      threads: Array<{ id: string; title: string; repo: string; number: number; status: string; priority: string | null; updatedAt: string }>
    }

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.storage).toBe('blobs')
    expect(body.notice).toBeNull()
    const row = body.threads.find((entry) => entry.id === threadId)
    expect(row).toMatchObject({ status: 'awaiting_approval', priority: 'high', repo: 'acme/widgets', number: 202 })
    expect(row?.title).toBe('acme/widgets #202: Router crashes when the page unmounts during nav...')
    expect(Number.isNaN(Date.parse(row?.updatedAt ?? ''))).toBe(false)
  })

  it('lists the new threads and skips a thread saved by the refund version, without failing', async () => {
    const blobs = (await import('@netlify/blobs')) as unknown as { getStore: () => { get: (key: string) => Promise<string | null>; set: (key: string, value: string) => Promise<unknown> } }
    const store = blobs.getStore()
    const current = JSON.parse((await store.get('threads/index')) ?? '[]') as unknown[]
    await store.set(
      'threads/index',
      JSON.stringify([
        { id: '3f2b6c1e-9a4d-4e8f-8b7a-1c2d3e4f5a6b', title: 'I was charged twice for ORD-1042', status: 'awaiting_approval', updatedAt: '2026-10-08T12:00:00.000Z', amount: 129 },
        ...current,
      ]),
    )

    const response = await threads(getFrom('/api/threads', 'ip-threads-3'))
    const body = (await response.json()) as { threads: Array<{ id: string }> }

    expect(response.status).toBe(200)
    expect(body.threads.length).toBeGreaterThan(0)
    expect(body.threads.some((entry) => entry.id === '3f2b6c1e-9a4d-4e8f-8b7a-1c2d3e4f5a6b')).toBe(false)
  })

  it('answers 405 to a POST', async () => {
    const response = await threads(postJson('/api/threads', {}, 'ip-threads-2'))
    expect(response.status).toBe(405)
  })
})
