import { describe, expect, it } from 'vitest'
import { claimThread } from '../../netlify/shared/claim'
import type { StreamEvent } from '../../netlify/shared/events'
import { inspectThread, resumeRun, startRun, type RunDeps } from '../../netlify/shared/run'
import { createMemoryStore } from '../../netlify/shared/store'
import { getThreadEntry, LEGACY_INDEX_KEY, listThreads } from '../../netlify/shared/thread-index'
import { fakeChat } from '../helpers/fake-chat'
import { BUG, CLASSIFIED_BUG, QUESTION } from '../helpers/issues'

const NOW = new Date('2026-10-09T12:00:00Z')
const RANDOM_ID = '3fba3d5e-61c2-4a55-9d3f-8b1e2f4a6c70'

function deps(chat = fakeChat({ classification: CLASSIFIED_BUG })): RunDeps {
  return { store: createMemoryStore(), storage: 'memory', chat, now: () => NOW }
}

const noop = () => {}

describe('repairing the summary of a thread saved by an earlier version', () => {
  async function rejectedLegacyThread() {
    const d = deps()
    await startRun(d, { issue: BUG, threadId: RANDOM_ID, budget: new AbortController().signal, send: noop })
    await resumeRun(d, {
      threadId: RANDOM_ID,
      entry: (await inspectThread(d, RANDOM_ID, undefined, { ownsClaim: true }))!.entry,
      answer: { action: 'reject' },
      budget: new AbortController().signal,
      send: noop,
    })
    return d
  }

  it('corrects a wrong listed priority from the result: a rejected thread has none', async () => {
    const d = await rejectedLegacyThread()
    // What the earlier version left: a plain summary and an index row, both with the proposal's priority.
    const wrong = { id: RANDOM_ID, title: 'acme/widgets #202: x', repo: 'acme/widgets', number: 202, status: 'completed', updatedAt: '2026-10-09T08:00:00.000Z', priority: 'medium' }
    for (const key of (await d.store.list('threads/')).filter((k) => k !== LEGACY_INDEX_KEY)) await d.store.delete(key)
    await d.store.set(`threads/${RANDOM_ID}`, JSON.stringify(wrong))
    await d.store.set(LEGACY_INDEX_KEY, JSON.stringify([wrong]))

    const info = await inspectThread(d, RANDOM_ID)

    expect(info?.entry).toMatchObject({ status: 'completed', priority: null })
    expect((await getThreadEntry(d.store, RANDOM_ID))?.priority).toBeNull()
    const listed = await listThreads(d.store)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: RANDOM_ID, priority: null })
    expect(await d.store.get(`threads/${RANDOM_ID}`)).toBeUndefined()
  })

  it('corrects it when only the legacy index row exists and it is wrong', async () => {
    const d = await rejectedLegacyThread()
    for (const key of (await d.store.list('threads/')).filter((k) => k !== LEGACY_INDEX_KEY)) await d.store.delete(key)
    await d.store.set(LEGACY_INDEX_KEY, JSON.stringify([{ id: RANDOM_ID, title: 't', repo: 'acme/widgets', number: 202, status: 'completed', updatedAt: '2026-10-09T08:00:00.000Z', priority: 'high' }]))

    await inspectThread(d, RANDOM_ID)

    expect((await listThreads(d.store))[0]).toMatchObject({ id: RANDOM_ID, priority: null })
  })
})

describe('the claim is released before the closing frame', () => {
  async function framesWithRelease(run: (send: (event: StreamEvent) => void, release: () => Promise<void>) => Promise<void>) {
    const log: string[] = []
    await run(
      (event) => log.push(event.type),
      async () => void log.push('release'),
    )
    return log
  }

  it('releases before the interrupt frame of a paused run, and nothing is sent after it', async () => {
    const d = deps()
    const log = await framesWithRelease((send, release) => startRun(d, { issue: BUG, threadId: RANDOM_ID, budget: new AbortController().signal, release, send }))
    expect(log.at(-1)).toBe('interrupt')
    expect(log.at(-2)).toBe('release')
    expect(log.filter((entry) => entry === 'release')).toHaveLength(1)
  })

  it('releases before the result frame of a finished run', async () => {
    const d = deps(fakeChat())
    const log = await framesWithRelease((send, release) => startRun(d, { issue: QUESTION, threadId: RANDOM_ID, budget: new AbortController().signal, release, send }))
    expect(log.slice(-2)).toEqual(['release', 'result'])
  })

  it('releases before the error frame of a failed run, after the failed step is reported', async () => {
    const d = deps(fakeChat())
    const failing: RunDeps = { ...d, chat: () => Promise.reject(new Error('boom')) }
    const log = await framesWithRelease((send, release) => startRun(failing, { issue: QUESTION, threadId: RANDOM_ID, budget: new AbortController().signal, release, send }))
    expect(log.slice(-2)).toEqual(['release', 'error'])
  })

  it('has the summary written by the time the claim is released', async () => {
    const d = deps()
    let seen: string | undefined
    await startRun(d, {
      issue: BUG,
      threadId: RANDOM_ID,
      budget: new AbortController().signal,
      release: async () => {
        seen = (await getThreadEntry(d.store, RANDOM_ID))?.status
      },
      send: noop,
    })
    expect(seen).toBe('awaiting_approval')
  })
})

describe('a thread held by a claim', () => {
  it('reads as running and is not rewritten while the claim is live', async () => {
    const d = deps()
    await startRun(d, { issue: BUG, threadId: RANDOM_ID, budget: new AbortController().signal, send: noop })
    const before = await listThreads(d.store)
    await claimThread(d.store, RANDOM_ID, NOW.getTime())

    const info = await inspectThread(d, RANDOM_ID)

    expect(info).toMatchObject({ running: true, proposal: null })
    expect(await listThreads(d.store)).toEqual(before)
  })
})
