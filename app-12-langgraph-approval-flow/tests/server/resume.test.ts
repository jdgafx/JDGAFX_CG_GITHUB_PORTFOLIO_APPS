import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { providerFetch } from '../helpers/fake-openrouter'
import { getFrom, postJson, readFrames, typesOf, type Frame } from '../helpers/http'

vi.mock('@netlify/blobs', async () => (await import('../helpers/fake-blobs')).fakeBlobsModule())

import resume from '../../netlify/functions/resume'
import start from '../../netlify/functions/start'

const LARGE = 'I was charged twice for ORD-1042. Both charges were $129.00, please refund the extra one.'
const NOT_AWAITING = 'This thread is not awaiting approval.'

function find(frames: Frame[], type: string): Record<string, unknown> | undefined {
  return frames.find((frame): frame is Record<string, unknown> => frame !== '[DONE]' && frame.type === type)
}

function nodeEnds(frames: Frame[]): Array<[unknown, unknown]> {
  return frames
    .filter((frame): frame is Record<string, unknown> => frame !== '[DONE]' && frame.type === 'node_end')
    .map((frame) => [frame.node, frame.status])
}

/** Starts the large duplicate-charge ticket and returns its thread id, paused at review. */
async function pausedThread(client: string): Promise<string> {
  vi.stubGlobal('fetch', providerFetch())
  const frames = await readFrames(await start(postJson('/api/start', { ticket: LARGE }, client)))
  const thread = find(frames, 'thread')
  if (!thread || typeof thread.threadId !== 'string') throw new Error('start sent no thread frame')
  return thread.threadId
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
})

afterEach(() => {
  process.env.OPENROUTER_API_KEY = ''
  vi.unstubAllGlobals()
})

describe('POST /api/resume', () => {
  it('approve continues from the checkpoint and streams review, reply and the result', async () => {
    const threadId = await pausedThread('ip-resume-1')
    vi.stubGlobal('fetch', providerFetch())

    const response = await resume(postJson('/api/resume', { threadId, decision: { action: 'approve' } }, 'ip-resume-1'))
    const frames = await readFrames(response)

    expect(response.status).toBe(200)
    expect(typesOf(frames)).toEqual(['thread', 'node_start', 'node_end', 'edge', 'node_start', 'node_end', 'result', '[DONE]'])
    expect(nodeEnds(frames)).toEqual([
      ['review', 'ok'],
      ['reply', 'ok'],
    ])
    expect(frames).toContainEqual({ type: 'edge', from: 'review', to: 'reply' })
    expect(find(frames, 'result')?.result).toMatchObject({
      action: 'refund',
      amount: 129,
      humanDecision: { action: 'approve' },
      reply: { subject: 'Your refund for ORD-1042' },
    })
  })

  it('edit refunds the edited amount when it is within the order total', async () => {
    const threadId = await pausedThread('ip-resume-2')
    vi.stubGlobal('fetch', providerFetch())

    const frames = await readFrames(
      await resume(postJson('/api/resume', { threadId, decision: { action: 'edit', amount: 100, note: 'Goodwill' } }, 'ip-resume-2')),
    )

    expect(find(frames, 'result')?.result).toMatchObject({
      action: 'refund',
      amount: 100,
      humanDecision: { action: 'edit', amount: 100, note: 'Goodwill' },
    })
  })

  it('refuses an edit above the order total with a plain 400, and the thread keeps waiting', async () => {
    const threadId = await pausedThread('ip-resume-3')
    vi.stubGlobal('fetch', providerFetch())

    const refused = await resume(postJson('/api/resume', { threadId, decision: { action: 'edit', amount: 500 } }, 'ip-resume-3'))

    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({
      success: false,
      error: 'The amount cannot be more than the order total of $129.00.',
    })
    const still = await resume(postJson('/api/resume', { threadId, decision: { action: 'reject' } }, 'ip-resume-3'))
    const frames = await readFrames(still)
    expect(find(frames, 'result')?.result).toMatchObject({ action: 'deny', amount: 0 })
  })

  it('reject streams a polite denial as the result', async () => {
    const threadId = await pausedThread('ip-resume-4')
    vi.stubGlobal('fetch', providerFetch({ email: 'Thank you for writing. We cannot refund this order.' }))

    const frames = await readFrames(
      await resume(postJson('/api/resume', { threadId, decision: { action: 'reject', note: 'Bank shows one charge' } }, 'ip-resume-4')),
    )

    expect(find(frames, 'result')?.result).toMatchObject({
      action: 'deny',
      amount: 0,
      reply: { subject: 'Update on ORD-1042', body: 'Thank you for writing. We cannot refund this order.' },
    })
  })

  it('answers 409 once the thread has already been resumed', async () => {
    const threadId = await pausedThread('ip-resume-5')
    vi.stubGlobal('fetch', providerFetch())
    await readFrames(await resume(postJson('/api/resume', { threadId, decision: { action: 'approve' } }, 'ip-resume-5')))

    const again = await resume(postJson('/api/resume', { threadId, decision: { action: 'approve' } }, 'ip-resume-5'))

    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ success: false, error: NOT_AWAITING })
  })

  it('refuses a second answer while the first resume is still running', async () => {
    const threadId = await pausedThread('ip-resume-9')
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const inner = providerFetch()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        await gate
        return inner(url, init)
      }),
    )

    const first = await resume(postJson('/api/resume', { threadId, decision: { action: 'approve' } }, 'ip-resume-9'))
    const second = await resume(postJson('/api/resume', { threadId, decision: { action: 'reject' } }, 'ip-resume-9'))

    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({
      success: false,
      error: 'This thread is already being resumed. Wait for that run to finish.',
    })
    release()
    const frames = await readFrames(first)
    expect(find(frames, 'result')?.result).toMatchObject({ action: 'refund', amount: 129 })
  })

  it('answers 409 for a thread id that was never started', async () => {
    const fetchStub = providerFetch()
    vi.stubGlobal('fetch', fetchStub)

    const response = await resume(
      postJson('/api/resume', { threadId: '3f2b6c1e-9a4d-4e8f-8b7a-1c2d3e4f5a6b', decision: { action: 'approve' } }, 'ip-resume-6'),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ success: false, error: NOT_AWAITING })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('answers 400 for a malformed thread id or an unknown decision, with plain messages', async () => {
    vi.stubGlobal('fetch', providerFetch())

    const badId = await resume(postJson('/api/resume', { threadId: 'nope', decision: { action: 'approve' } }, 'ip-resume-7'))
    expect(badId.status).toBe(400)
    expect(await badId.json()).toEqual({ success: false, error: 'The thread id is not valid.' })

    const badAction = await resume(
      postJson('/api/resume', { threadId: '3f2b6c1e-9a4d-4e8f-8b7a-1c2d3e4f5a6b', decision: { action: 'maybe' } }, 'ip-resume-7'),
    )
    expect(badAction.status).toBe(400)
    expect(await badAction.json()).toEqual({ success: false, error: 'Choose approve, edit or reject.' })
  })

  it('answers 405 to a GET', async () => {
    const response = await resume(getFrom('/api/resume', 'ip-resume-8'))
    expect(response.status).toBe(405)
  })
})
