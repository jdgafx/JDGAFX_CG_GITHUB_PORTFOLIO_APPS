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

describe('the priority of a finished thread comes from its result', () => {
  it('keeps "not set" for a rejected thread when it is opened, and does not rewrite its summary', async () => {
    const id = await startOne(4000, 'ip-cons-h')
    vi.stubGlobal('fetch', providerFetch())
    await readFrames(await resume(postJson('/api/resume', { threadId: id, decision: { action: 'reject' } }, 'ip-cons-h')))
    expect((await listed('ip-cons-h')).find((row) => row.id === id)).toMatchObject({ status: 'completed', priority: null })
    const store = await rawStore()
    const before = await store.get(`threads/${id}`)

    const body = (await (await thread(getFrom(`/api/thread?id=${id}`, 'ip-cons-h'))).json()) as Record<string, unknown>

    expect(body).toMatchObject({ status: 'completed', result: { outcome: 'rejected', priority: null } })
    expect(await store.get(`threads/${id}`)).toBe(before)
    expect((await listed('ip-cons-h')).find((row) => row.id === id)?.priority).toBeNull()
  })

  it('repairs a stale priority to the one in the result, for an edited thread', async () => {
    const id = await startOne(4100, 'ip-cons-i')
    vi.stubGlobal('fetch', providerFetch())
    await readFrames(
      await resume(postJson('/api/resume', { threadId: id, decision: { action: 'edit', labels: ['bug'], priority: 'low' } }, 'ip-cons-i')),
    )
    const store = await rawStore()
    await store.set(`threads/${id}`, JSON.stringify({ id, title: 'x', repo: 'acme/widgets', number: 4100, status: 'completed', updatedAt: '2026-10-09T00:00:00.000Z', priority: 'high' }))

    await thread(getFrom(`/api/thread?id=${id}`, 'ip-cons-i'))

    expect((await listed('ip-cons-i')).find((row) => row.id === id)).toMatchObject({ status: 'completed', priority: 'low' })
  })
})

/** A fetch that holds every model call until `release` is called, then answers as the fake provider does. */
function gatedProvider(options: Parameters<typeof providerFetch>[0] = {}) {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const inner = providerFetch(options)
  const stub = vi.fn(async (url: string, init: RequestInit) => {
    await gate
    return inner(url, init)
  })
  return { stub, release: () => release() }
}

describe('two people on one thread (the claim works across function instances)', () => {
  it('lets exactly one of two simultaneous answers run, and tells the other so', async () => {
    const id = await startOne(5000, 'ip-cons-j')
    vi.stubGlobal('fetch', providerFetch())

    const [approve, reject] = await Promise.all([
      resume(postJson('/api/resume', { threadId: id, decision: { action: 'approve' } }, 'ip-cons-j1')),
      resume(postJson('/api/resume', { threadId: id, decision: { action: 'reject' } }, 'ip-cons-j2')),
    ])

    const statuses = [approve.status, reject.status].sort()
    expect(statuses).toEqual([200, 409])
    const loser = approve.status === 409 ? approve : reject
    expect(await loser.json()).toEqual({ success: false, error: 'Another maintainer is handling this thread. Refresh to see the result.' })
    const winner = approve.status === 200 ? approve : reject
    const result = find(await readFrames(winner), 'result')?.result as { outcome: string }
    const final = (await (await thread(getFrom(`/api/thread?id=${id}`, 'ip-cons-j'))).json()) as { result: { outcome: string } }
    expect(final.result.outcome).toBe(result.outcome)
  })

  it('refuses a retry while the thread is being resumed, and shows the thread as running, not failed', async () => {
    const id = await startOne(5100, 'ip-cons-k')
    const gated = gatedProvider()
    vi.stubGlobal('fetch', gated.stub)
    const store = await rawStore()
    const summaryBefore = await store.get(`threads/${id}`)

    const running = await resume(postJson('/api/resume', { threadId: id, decision: { action: 'edit', labels: ['bug'], priority: 'low' } }, 'ip-cons-k1'))
    for (let i = 0; i < 4; i += 1) {
      const retry = (await import('../../netlify/functions/retry')).default
      const refused = await retry(postJson('/api/retry', { threadId: id }, `ip-cons-k${i + 2}`))
      expect(refused.status).toBe(409)
      expect(await refused.json()).toEqual({ success: false, error: 'Another maintainer is handling this thread. Refresh to see the result.' })
    }
    const second = await resume(postJson('/api/resume', { threadId: id, decision: { action: 'reject' } }, 'ip-cons-k7'))
    expect(second.status).toBe(409)

    const during = (await (await thread(getFrom(`/api/thread?id=${id}`, 'ip-cons-k8'))).json()) as Record<string, unknown>
    expect(during).toMatchObject({ status: 'running', retryable: false, proposal: null, result: null })
    // Opening it while it runs wrote nothing: the summary is exactly what the run left.
    expect(await store.get(`threads/${id}`)).toBe(summaryBefore)

    gated.release()
    const frames = await readFrames(running)
    expect(find(frames, 'result')?.result).toMatchObject({ outcome: 'edited', priority: 'low' })
    // One resume, so one reply call: the refused retries and the second answer called no model.
    expect(gated.stub).toHaveBeenCalledTimes(1)

    const after = (await (await thread(getFrom(`/api/thread?id=${id}`, 'ip-cons-k9'))).json()) as Record<string, unknown>
    expect(after).toMatchObject({ status: 'completed', retryable: false })
    // The claim is released, so a late answer now gets the ordinary message.
    const late = await resume(postJson('/api/resume', { threadId: id, decision: { action: 'approve' } }, 'ip-cons-k10'))
    expect(await late.json()).toEqual({ success: false, error: 'This thread is not awaiting approval.' })
  })

  it('shows a thread as running, not failed, while its first run is still going', async () => {
    const gated = gatedProvider({ classification: CLASSIFIED_BUG })
    vi.stubGlobal('fetch', gated.stub)
    const response = await start(postJson('/api/start', { issue: issue({ number: 5200, title: BUG.title, body: BUG.body, labels: BUG.labels }) }, 'ip-cons-l'))
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    const id = (JSON.parse(first.split('\n\n')[0].slice(6)) as { threadId: string }).threadId
    // Give the graph a moment to save its input checkpoint, which it does before the first model call.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const during = (await (await thread(getFrom(`/api/thread?id=${id}`, 'ip-cons-l1'))).json()) as Record<string, unknown>
    expect(during).toMatchObject({ status: 'running', retryable: false })

    gated.release()
    for (;;) if ((await reader.read()).done) break
    const after = (await (await thread(getFrom(`/api/thread?id=${id}`, 'ip-cons-l2'))).json()) as Record<string, unknown>
    expect(after).toMatchObject({ status: 'awaiting_approval', retryable: false })
  })

  it('takes over a claim left by a run that crashed, once it is older than a minute', async () => {
    const id = await startOne(5300, 'ip-cons-m')
    const store = await rawStore()
    await store.set(`claims/${id}`, JSON.stringify({ owner: 'crashed-run', at: Date.now() - 61_000 }))
    vi.stubGlobal('fetch', providerFetch())

    const frames = await readFrames(await resume(postJson('/api/resume', { threadId: id, decision: { action: 'approve' } }, 'ip-cons-m')))

    expect(find(frames, 'result')?.result).toMatchObject({ outcome: 'approved' })
    expect(await store.get(`claims/${id}`)).toBeNull()
  })

  it('releases the claim when a request is refused after it, so the thread is not locked for a minute', async () => {
    const id = await startOne(5400, 'ip-cons-n')
    const store = await rawStore()
    const refused = await resume(postJson('/api/resume', { threadId: id, decision: { action: 'edit', labels: ['not-offered'], priority: 'low' } }, 'ip-cons-n'))
    expect(refused.status).toBe(400)
    expect(await store.get(`claims/${id}`)).toBeNull()
  })
})
