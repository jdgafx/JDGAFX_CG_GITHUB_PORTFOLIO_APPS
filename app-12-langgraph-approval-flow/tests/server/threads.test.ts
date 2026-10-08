import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { providerFetch } from '../helpers/fake-openrouter'
import { getFrom, postJson, readFrames, type Frame } from '../helpers/http'

vi.mock('@netlify/blobs', async () => (await import('../helpers/fake-blobs')).fakeBlobsModule())

import start from '../../netlify/functions/start'
import threads from '../../netlify/functions/threads'

const LARGE = 'I was charged twice for ORD-1042. Both charges were $129.00, please refund the extra one.'

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
})

afterEach(() => {
  process.env.OPENROUTER_API_KEY = ''
  vi.unstubAllGlobals()
})

describe('GET /api/threads', () => {
  it('lists a waiting thread with its status, amount and a short title', async () => {
    vi.stubGlobal('fetch', providerFetch())
    const frames: Frame[] = await readFrames(await start(postJson('/api/start', { ticket: LARGE }, 'ip-threads-1')))
    const thread = frames.find((frame): frame is Record<string, unknown> => frame !== '[DONE]' && frame.type === 'thread')
    const threadId = thread?.threadId

    const response = await threads(getFrom('/api/threads', 'ip-threads-1'))
    const body = (await response.json()) as {
      success: boolean
      storage: string
      notice: string | null
      threads: Array<{ id: string; title: string; status: string; amount: number | null; updatedAt: string }>
    }

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.storage).toBe('blobs')
    expect(body.notice).toBeNull()
    const row = body.threads.find((entry) => entry.id === threadId)
    expect(row).toMatchObject({ status: 'awaiting_approval', amount: 129 })
    expect(row?.title.startsWith('I was charged twice for ORD-1042')).toBe(true)
    expect(row?.title.endsWith('...')).toBe(true)
    expect(Number.isNaN(Date.parse(row?.updatedAt ?? ''))).toBe(false)
  })

  it('answers 405 to a POST', async () => {
    const response = await threads(postJson('/api/threads', {}, 'ip-threads-2'))
    expect(response.status).toBe(405)
  })
})
