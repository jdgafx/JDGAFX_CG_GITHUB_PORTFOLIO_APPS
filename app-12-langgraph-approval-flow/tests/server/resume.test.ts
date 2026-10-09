import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { providerFetch } from '../helpers/fake-openrouter'
import { getFrom, postJson, readFrames, typesOf, type Frame } from '../helpers/http'
import { BUG, CLASSIFIED_BUG } from '../helpers/issues'

vi.mock('@netlify/blobs', async () => (await import('../helpers/fake-blobs')).fakeBlobsModule())

import resume from '../../netlify/functions/resume'
import start from '../../netlify/functions/start'

const NOT_AWAITING = 'This thread is not awaiting approval.'
const UNKNOWN_ID = '3f2b6c1e-9a4d-4e8f-8b7a-1c2d3e4f5a6b'

function find(frames: Frame[], type: string): Record<string, unknown> | undefined {
  return frames.find((frame): frame is Record<string, unknown> => frame !== '[DONE]' && frame.type === type)
}

function nodeEnds(frames: Frame[]): Array<[unknown, unknown]> {
  return frames
    .filter((frame): frame is Record<string, unknown> => frame !== '[DONE]' && frame.type === 'node_end')
    .map((frame) => [frame.node, frame.status])
}

/** Starts the high-severity bug and returns its thread id, paused at review. */
async function pausedThread(client: string): Promise<string> {
  vi.stubGlobal('fetch', providerFetch({ classification: CLASSIFIED_BUG }))
  const frames = await readFrames(await start(postJson('/api/start', { issue: BUG }, client)))
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
    const fetchStub = providerFetch()
    vi.stubGlobal('fetch', fetchStub)

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
      outcome: 'approved',
      path: 'human',
      labels: ['bug', 'area: router'],
      priority: 'high',
      humanDecision: { action: 'approve' },
      issue: { number: 202 },
    })
    // The classify call is not repeated after the pause: only the reply is drafted.
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('edit applies the maintainer labels and priority', async () => {
    const threadId = await pausedThread('ip-resume-2')
    vi.stubGlobal('fetch', providerFetch())

    const frames = await readFrames(
      await resume(
        postJson(
          '/api/resume',
          { threadId, decision: { action: 'edit', labels: ['bug', 'good first issue'], priority: 'low', note: 'Easy fix' } },
          'ip-resume-2',
        ),
      ),
    )

    expect(find(frames, 'result')?.result).toMatchObject({
      outcome: 'edited',
      labels: ['bug', 'good first issue'],
      priority: 'low',
      humanDecision: { action: 'edit', labels: ['bug', 'good first issue'], priority: 'low', note: 'Easy fix' },
    })
  })

  it('refuses an edit with a label the card did not offer, with a plain 400, and the thread keeps waiting', async () => {
    const threadId = await pausedThread('ip-resume-3')
    vi.stubGlobal('fetch', providerFetch())

    const refused = await resume(
      postJson('/api/resume', { threadId, decision: { action: 'edit', labels: ['bug', 'wontfix-ever'], priority: 'low' } }, 'ip-resume-3'),
    )

    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({
      success: false,
      error: '"wontfix-ever" is not one of the labels offered. Pick from the list.',
    })
    const still = await resume(postJson('/api/resume', { threadId, decision: { action: 'reject' } }, 'ip-resume-3'))
    const frames = await readFrames(still)
    expect(find(frames, 'result')?.result).toMatchObject({ outcome: 'rejected', labels: [], priority: null })
  })

  it('accepts the area label the rules proposed, which is not in the fixed list', async () => {
    const threadId = await pausedThread('ip-resume-10')
    vi.stubGlobal('fetch', providerFetch())

    const frames = await readFrames(
      await resume(postJson('/api/resume', { threadId, decision: { action: 'edit', labels: ['area: router'], priority: 'medium' } }, 'ip-resume-10')),
    )

    expect(find(frames, 'result')?.result).toMatchObject({ outcome: 'edited', labels: ['area: router'] })
  })

  it('reject streams fixed wording that says only that a maintainer looked, with nothing applied and no model call', async () => {
    const threadId = await pausedThread('ip-resume-4')
    const fetchStub = providerFetch({ email: 'We have noted these facts on the issue. Do not treat this as a final decision.' })
    vi.stubGlobal('fetch', fetchStub)

    const frames = await readFrames(
      await resume(postJson('/api/resume', { threadId, decision: { action: 'reject', note: 'Cannot reproduce' } }, 'ip-resume-4')),
    )

    expect(find(frames, 'result')?.result).toMatchObject({
      outcome: 'rejected',
      labels: [],
      priority: null,
      humanDecision: { action: 'reject', note: 'Cannot reproduce' },
      reply: { body: 'Thank you for the report. A maintainer has looked at this issue.' },
    })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('refuses an edit with no labels, with a plain 400, and the thread keeps waiting', async () => {
    const threadId = await pausedThread('ip-resume-11')
    const refused = await resume(postJson('/api/resume', { threadId, decision: { action: 'edit', labels: [], priority: 'low' } }, 'ip-resume-11'))
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({
      success: false,
      error: 'Pick 1 to 8 labels, each up to 50 characters. To apply none, reject instead.',
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
      error: 'Another maintainer is handling this thread. Refresh to see the result.',
    })
    release()
    const frames = await readFrames(first)
    expect(find(frames, 'result')?.result).toMatchObject({ outcome: 'approved', priority: 'high' })
  })

  it('answers 409 for a thread id that was never started', async () => {
    const fetchStub = providerFetch()
    vi.stubGlobal('fetch', fetchStub)

    const response = await resume(postJson('/api/resume', { threadId: UNKNOWN_ID, decision: { action: 'approve' } }, 'ip-resume-6'))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ success: false, error: NOT_AWAITING })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('answers 400 for a malformed thread id or an unknown decision, with plain messages', async () => {
    vi.stubGlobal('fetch', providerFetch())

    const badId = await resume(postJson('/api/resume', { threadId: 'nope', decision: { action: 'approve' } }, 'ip-resume-7'))
    expect(badId.status).toBe(400)
    expect(await badId.json()).toEqual({ success: false, error: 'The thread id is not valid.' })

    const badAction = await resume(postJson('/api/resume', { threadId: UNKNOWN_ID, decision: { action: 'maybe' } }, 'ip-resume-7'))
    expect(badAction.status).toBe(400)
    expect(await badAction.json()).toEqual({ success: false, error: 'Choose approve, edit or reject.' })

    const badEdit = await resume(postJson('/api/resume', { threadId: UNKNOWN_ID, decision: { action: 'edit', labels: ['bug'], priority: 'p0' } }, 'ip-resume-7'))
    expect(badEdit.status).toBe(400)
    expect(await badEdit.json()).toEqual({ success: false, error: 'Choose a priority: low, medium, high, urgent.' })
  })

  it('answers 405 to a GET', async () => {
    const response = await resume(getFrom('/api/resume', 'ip-resume-8'))
    expect(response.status).toBe(405)
  })
})
