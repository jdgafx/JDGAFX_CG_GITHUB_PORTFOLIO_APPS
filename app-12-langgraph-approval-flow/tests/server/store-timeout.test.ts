import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { untilSettled } from '../helpers/fake-time'
import { getFrom, postJson } from '../helpers/http'

// The Blobs stand-in keeps its data here. A test seeds the index, and can make one key prefix hang.
const shared = vi.hoisted(() => ({ values: new Map<string, string>(), hang: null as string | null }))

vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    get: (key: string) => {
      if (shared.hang !== null && key.startsWith(shared.hang)) return new Promise<string>(() => {})
      return Promise.resolve(shared.values.get(key) ?? null)
    },
    set: async (key: string, value: string) => {
      shared.values.set(key, value)
      return { modified: true }
    },
    delete: async (key: string) => {
      shared.values.delete(key)
    },
    list: (options: { prefix?: string }) => {
      const keys = [...shared.values.keys()].filter((key) => key.startsWith(options.prefix ?? ''))
      return (async function* pages() {
        yield { blobs: keys.map((key) => ({ key, etag: 'fake' })), directories: [] }
      })()
    },
  }),
}))

import resume from '../../netlify/functions/resume'
import threads from '../../netlify/functions/threads'
import { STORE_SLOW } from '../../netlify/shared/store'

const WAITING_ID = '3f2b6c1e-9a4d-4e8f-8b7a-1c2d3e4f5a6b'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
  shared.hang = null
  shared.values.clear()
  shared.values.set(
    'threads/index',
    JSON.stringify([
      { id: WAITING_ID, title: 'acme/widgets #202: Router crashes', repo: 'acme/widgets', number: 202, status: 'awaiting_approval', updatedAt: '2026-10-09T12:00:00.000Z', priority: 'high' },
    ]),
  )
})

afterEach(() => {
  vi.useRealTimers()
  process.env.OPENROUTER_API_KEY = ''
  vi.unstubAllGlobals()
  shared.hang = null
})

describe('a store that never answers', () => {
  it('answers 503 with the plain message when the thread list read hangs', async () => {
    shared.hang = 'threads/'
    const response = await untilSettled(threads(getFrom('/api/threads', 'ip-store-1')))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ success: false, error: STORE_SLOW })
  })

  it('answers 503 on resume when the checkpoint read hangs, and never calls the model', async () => {
    shared.hang = 'thread/'
    const fetchStub = vi.fn(async () => new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', fetchStub)

    const response = await untilSettled(
      resume(postJson('/api/resume', { threadId: WAITING_ID, decision: { action: 'approve' } }, 'ip-store-2')),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ success: false, error: STORE_SLOW })
    expect(fetchStub).not.toHaveBeenCalled()
  })
})
