import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { providerFetch } from '../helpers/fake-openrouter'
import { getFrom, postJson, readFrames, type Frame } from '../helpers/http'
import { BUG, CLASSIFIED_BUG, issue } from '../helpers/issues'

vi.mock('@netlify/blobs', async () => (await import('../helpers/fake-blobs')).fakeBlobsModule())

import resume from '../../netlify/functions/resume'
import start from '../../netlify/functions/start'
import thread from '../../netlify/functions/thread'
import threads from '../../netlify/functions/threads'

interface Row {
  id: string
  status: string
  priority: string | null
}

function find(frames: Frame[], type: string): Record<string, unknown> | undefined {
  return frames.find((frame): frame is Record<string, unknown> => frame !== '[DONE]' && frame.type === type)
}

async function rawStore() {
  const blobs = (await import('@netlify/blobs')) as unknown as {
    getStore: () => { get: (key: string) => Promise<string | null>; set: (key: string, value: string) => Promise<unknown>; delete: (key: string) => Promise<void> }
  }
  return blobs.getStore()
}

async function startOne(number: number, client: string): Promise<string> {
  const frames = await readFrames(await start(postJson('/api/start', { issue: issue({ number, title: BUG.title, body: BUG.body, labels: BUG.labels }) }, client)))
  const id = find(frames, 'thread')?.threadId
  if (typeof id !== 'string') throw new Error('no thread frame')
  return id
}

async function listed(client: string): Promise<Row[]> {
  const body = (await (await threads(getFrom('/api/threads', client))).json()) as { threads: Row[] }
  return body.threads
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
  vi.stubGlobal('fetch', providerFetch({ classification: CLASSIFIED_BUG }))
})

afterEach(() => {
  process.env.OPENROUTER_API_KEY = ''
  vi.unstubAllGlobals()
})

describe('concurrent runs (the in-memory Blobs stand-in, not the real service)', () => {
  it('lists every thread when ten runs start at the same moment', async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, (_, i) => startOne(1000 + i, `ip-cons-a${i}`)))

    const rows = await listed('ip-cons-a')
    for (const id of ids) expect(rows.find((row) => row.id === id)).toMatchObject({ status: 'awaiting_approval', priority: 'high' })
  })

  it('shows every thread as completed when five paused threads are answered at the same moment', async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, (_, i) => startOne(2000 + i, `ip-cons-b${i}`)))
    vi.stubGlobal('fetch', providerFetch())

    const results = await Promise.all(
      ids.map(async (threadId, i) => readFrames(await resume(postJson('/api/resume', { threadId, decision: { action: 'approve' } }, `ip-cons-c${i}`)))),
    )

    for (const frames of results) expect(find(frames, 'result')).toBeDefined()
    const rows = await listed('ip-cons-b')
    for (const id of ids) expect(rows.find((row) => row.id === id)?.status).toBe('completed')
  })
})

describe('the checkpoint is the source of truth, not the summary', () => {
  it('shows the result of a completed thread whose summary still says awaiting, and repairs the summary', async () => {
    const id = await startOne(3000, 'ip-cons-d')
    vi.stubGlobal('fetch', providerFetch())
    await readFrames(await resume(postJson('/api/resume', { threadId: id, decision: { action: 'approve' } }, 'ip-cons-d')))
    const store = await rawStore()
    const stale = JSON.stringify({ id, title: 'stale', repo: 'acme/widgets', number: 3000, status: 'awaiting_approval', updatedAt: '2026-10-09T00:00:00.000Z', priority: 'high' })
    await store.set(`threads/${id}`, stale)

    const body = (await (await thread(getFrom(`/api/thread?id=${id}`, 'ip-cons-d'))).json()) as Record<string, unknown>

    expect(body).toMatchObject({ status: 'completed', proposal: null, retryable: false, result: { outcome: 'approved', priority: 'high' } })
    const repaired = JSON.parse((await store.get(`threads/${id}`)) ?? '{}') as Row
    expect(repaired.status).toBe('completed')
    expect((await listed('ip-cons-d')).find((row) => row.id === id)?.status).toBe('completed')
  })

  it('shows the approval card of a paused thread whose summary says completed, and lets it be resumed', async () => {
    const id = await startOne(3100, 'ip-cons-e')
    const store = await rawStore()
    const wrong = JSON.stringify({ id, title: 'wrong', repo: 'acme/widgets', number: 3100, status: 'completed', updatedAt: '2026-10-09T00:00:00.000Z', priority: null })
    await store.set(`threads/${id}`, wrong)

    const body = (await (await thread(getFrom(`/api/thread?id=${id}`, 'ip-cons-e'))).json()) as Record<string, unknown>
    expect(body).toMatchObject({ status: 'awaiting_approval', result: null, proposal: { triage: { priority: 'high' } } })

    await store.set(`threads/${id}`, wrong)
    vi.stubGlobal('fetch', providerFetch())
    const frames = await readFrames(await resume(postJson('/api/resume', { threadId: id, decision: { action: 'approve' } }, 'ip-cons-e')))
    expect(find(frames, 'result')?.result).toMatchObject({ outcome: 'approved' })
  })

  it('opens, lists and resumes a thread whose summary was never written or was lost', async () => {
    const id = await startOne(3200, 'ip-cons-f')
    const store = await rawStore()
    await store.delete(`threads/${id}`)
    expect((await listed('ip-cons-f')).some((row) => row.id === id)).toBe(false)

    const body = (await (await thread(getFrom(`/api/thread?id=${id}`, 'ip-cons-f'))).json()) as Record<string, unknown>
    expect(body).toMatchObject({ status: 'awaiting_approval', title: 'acme/widgets #3200: Router crashes when the page unmounts during na...' })
    // Opening it repaired the summary, so the list shows it again.
    expect((await listed('ip-cons-f')).find((row) => row.id === id)).toMatchObject({ status: 'awaiting_approval', priority: 'high' })

    await store.delete(`threads/${id}`)
    vi.stubGlobal('fetch', providerFetch())
    const frames = await readFrames(await resume(postJson('/api/resume', { threadId: id, decision: { action: 'reject' } }, 'ip-cons-f')))
    expect(find(frames, 'result')?.result).toMatchObject({ outcome: 'rejected' })
    expect((await listed('ip-cons-f')).find((row) => row.id === id)?.status).toBe('completed')
  })

  it('logs a failed summary write with the thread id instead of swallowing it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = await rawStore()
    const realSet = store.set.bind(store)
    // The summary keys fail to write; the checkpoint keys keep working.
    vi.spyOn(store, 'set').mockImplementation(async (key: string, value: string) => {
      if (key.startsWith('threads/')) throw new Error('blobs is down')
      return realSet(key, value)
    })

    const id = await startOne(3300, 'ip-cons-g')

    const messages = error.mock.calls.map((call) => String(call[0]))
    expect(messages.filter((message) => message.includes(id) && message.includes('could not write the summary'))).toHaveLength(2)
    // The thread is still reachable: its checkpoint says it is waiting.
    const body = (await (await thread(getFrom(`/api/thread?id=${id}`, 'ip-cons-g'))).json()) as Record<string, unknown>
    expect(body).toMatchObject({ status: 'awaiting_approval' })
    vi.restoreAllMocks()
  })
})
