import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { providerFetch } from '../helpers/fake-openrouter'
import { getFrom, postJson, readFrames, type Frame } from '../helpers/http'
import { BUG, CLASSIFIED_BUG } from '../helpers/issues'

vi.mock('@netlify/blobs', async () => (await import('../helpers/fake-blobs')).fakeBlobsModule())

import resume from '../../netlify/functions/resume'
import start from '../../netlify/functions/start'
import thread from '../../netlify/functions/thread'

function find(frames: Frame[], type: string): Record<string, unknown> | undefined {
  return frames.find((frame): frame is Record<string, unknown> => frame !== '[DONE]' && frame.type === type)
}

async function pausedThread(client: string): Promise<string> {
  vi.stubGlobal('fetch', providerFetch({ classification: CLASSIFIED_BUG }))
  const frames = await readFrames(await start(postJson('/api/start', { issue: BUG }, client)))
  const threadFrame = find(frames, 'thread')
  if (typeof threadFrame?.threadId !== 'string') throw new Error('start sent no thread frame')
  return threadFrame.threadId
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
})

afterEach(() => {
  process.env.OPENROUTER_API_KEY = ''
  vi.unstubAllGlobals()
})

describe('GET /api/thread', () => {
  it('shows a waiting thread with its proposal, the trace so far, and no result', async () => {
    const threadId = await pausedThread('ip-thread-1')

    const response = await thread(getFrom(`/api/thread?id=${threadId}`, 'ip-thread-1'))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      threadId,
      status: 'awaiting_approval',
      storage: 'blobs',
      proposal: { issue: { number: 202 }, triage: { priority: 'high', labels: ['bug', 'area: router'] } },
      result: null,
      issue: BUG,
      title: 'acme/widgets #202: Router crashes when the page unmounts during nav...',
    })
    const trace = body.trace as Array<{ node: string; status: string }>
    expect(trace.map((row) => [row.node, row.status])).toEqual([
      ['classify', 'ok'],
      ['decide', 'ok'],
      ['review', 'pending'],
      ['reply', 'pending'],
    ])
  })

  it('shows a completed thread with its result and no proposal', async () => {
    const threadId = await pausedThread('ip-thread-2')
    vi.stubGlobal('fetch', providerFetch())
    await readFrames(
      await resume(postJson('/api/resume', { threadId, decision: { action: 'approve' } }, 'ip-thread-2')),
    )

    const body = (await (await thread(getFrom(`/api/thread?id=${threadId}`, 'ip-thread-2'))).json()) as Record<string, unknown>

    expect(body).toMatchObject({ status: 'completed', proposal: null })
    expect(body.result).toMatchObject({ outcome: 'approved', labels: ['bug', 'area: router'], priority: 'high', reply: { body: 'Thanks for the report. We have triaged this issue.' } })
  })

  it('answers 404 for a well-formed id that no thread has', async () => {
    const response = await thread(getFrom('/api/thread?id=3f2b6c1e-9a4d-4e8f-8b7a-1c2d3e4f5a6b', 'ip-thread-3'))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ success: false, error: 'Thread not found.' })
  })

  it('answers 400 when the id is missing or malformed', async () => {
    const response = await thread(getFrom('/api/thread?id=../etc', 'ip-thread-4'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ success: false, error: 'Pass a valid thread id.' })
  })

  it('answers 405 to a POST', async () => {
    const response = await thread(postJson('/api/thread?id=x', {}, 'ip-thread-5'))
    expect(response.status).toBe(405)
  })
})
