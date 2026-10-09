import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { providerFetch } from '../helpers/fake-openrouter'
import { getFrom, postJson, readFrames, type Frame } from '../helpers/http'
import { BUG, CLASSIFIED_BUG, QUESTION } from '../helpers/issues'

vi.mock('@netlify/blobs', async () => (await import('../helpers/fake-blobs')).fakeBlobsModule())

import resume from '../../netlify/functions/resume'
import retry from '../../netlify/functions/retry'
import start from '../../netlify/functions/start'
import thread from '../../netlify/functions/thread'

function find(frames: Frame[], type: string): Record<string, unknown> | undefined {
  return frames.find((frame): frame is Record<string, unknown> => frame !== '[DONE]' && frame.type === type)
}

function nodeEnds(frames: Frame[]): Array<[unknown, unknown]> {
  return frames
    .filter((frame): frame is Record<string, unknown> => frame !== '[DONE]' && frame.type === 'node_end')
    .map((frame) => [frame.node, frame.status])
}

async function threadIdOf(response: Response): Promise<{ id: string; frames: Frame[] }> {
  const frames = await readFrames(response)
  const frame = find(frames, 'thread')
  if (typeof frame?.threadId !== 'string') throw new Error('no thread frame')
  return { id: frame.threadId, frames }
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.env.OPENROUTER_API_KEY = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('POST /api/retry', () => {
  it('continues a thread whose first model call failed: classify runs again, then the run finishes', async () => {
    vi.stubGlobal('fetch', providerFetch({ status: 500 }))
    const { id, frames } = await threadIdOf(await start(postJson('/api/start', { issue: QUESTION }, 'ip-retry-1')))
    expect(find(frames, 'error')).toBeDefined()
    const failed = (await (await thread(getFrom(`/api/thread?id=${id}`, 'ip-retry-1'))).json()) as Record<string, unknown>
    expect(failed).toMatchObject({ status: 'failed', retryable: true })

    vi.stubGlobal('fetch', providerFetch())
    const again = await readFrames(await retry(postJson('/api/retry', { threadId: id }, 'ip-retry-1')))

    expect(nodeEnds(again)).toEqual([
      ['classify', 'ok'],
      ['duplicates', 'ok'],
      ['decide', 'ok'],
      ['review', 'skipped'],
      ['reply', 'ok'],
    ])
    expect(find(again, 'result')?.result).toMatchObject({ outcome: 'auto', path: 'auto' })
    const done = (await (await thread(getFrom(`/api/thread?id=${id}`, 'ip-retry-1'))).json()) as Record<string, unknown>
    expect(done).toMatchObject({ status: 'completed', retryable: false })
  })

  it('keeps the classification and the maintainer answer when the reply fails, and runs only the reply on retry', async () => {
    vi.stubGlobal('fetch', providerFetch({ classification: CLASSIFIED_BUG }))
    const { id } = await threadIdOf(await start(postJson('/api/start', { issue: BUG }, 'ip-retry-2')))

    // The maintainer edits, but the reply call fails.
    vi.stubGlobal('fetch', providerFetch({ status: 500 }))
    const resumed = await readFrames(
      await resume(postJson('/api/resume', { threadId: id, decision: { action: 'edit', labels: ['bug'], priority: 'low', note: 'Minor' } }, 'ip-retry-2')),
    )
    expect(nodeEnds(resumed)).toEqual([
      ['review', 'ok'],
      ['reply', 'failed'],
    ])
    const failed = (await (await thread(getFrom(`/api/thread?id=${id}`, 'ip-retry-2'))).json()) as Record<string, unknown>
    expect(failed).toMatchObject({ status: 'failed', retryable: true })
    expect((failed.trace as Array<{ node: string; status: string }>).map((row) => [row.node, row.status])).toEqual([
      ['classify', 'ok'],
      ['duplicates', 'ok'],
      ['decide', 'ok'],
      ['review', 'ok'],
      ['reply', 'skipped'],
    ])

    const working = providerFetch({ email: 'Thanks for the report.' })
    vi.stubGlobal('fetch', working)
    const again = await readFrames(await retry(postJson('/api/retry', { threadId: id }, 'ip-retry-2')))

    expect(nodeEnds(again)).toEqual([['reply', 'ok']])
    expect(working).toHaveBeenCalledTimes(1)
    expect(find(again, 'result')?.result).toMatchObject({
      outcome: 'edited',
      labels: ['bug'],
      priority: 'low',
      humanDecision: { action: 'edit', labels: ['bug'], priority: 'low', note: 'Minor' },
      classification: { type: 'bug', severity: 'high' },
      reply: { body: 'Thanks for the report.' },
    })
  })

  it('refuses a thread that is waiting or finished, and one that was never started, with plain 409s', async () => {
    vi.stubGlobal('fetch', providerFetch({ classification: CLASSIFIED_BUG }))
    const { id } = await threadIdOf(await start(postJson('/api/start', { issue: BUG }, 'ip-retry-3')))

    const waiting = await retry(postJson('/api/retry', { threadId: id }, 'ip-retry-3'))
    expect(waiting.status).toBe(409)
    expect(await waiting.json()).toEqual({ success: false, error: 'This thread did not fail, so there is nothing to retry.' })

    const unknown = await retry(postJson('/api/retry', { threadId: '3f2b6c1e-9a4d-4e8f-8b7a-1c2d3e4f5a6b' }, 'ip-retry-3'))
    expect(unknown.status).toBe(409)
  })

  it('answers 400 for a bad id, 405 to a GET, and 503 with no key', async () => {
    const bad = await retry(postJson('/api/retry', { threadId: '../x' }, 'ip-retry-4'))
    expect(bad.status).toBe(400)
    expect((await retry(getFrom('/api/retry', 'ip-retry-4'))).status).toBe(405)
    process.env.OPENROUTER_API_KEY = ''
    expect((await retry(postJson('/api/retry', { threadId: '3f2b6c1e-9a4d-4e8f-8b7a-1c2d3e4f5a6b' }, 'ip-retry-4'))).status).toBe(503)
  })
})
