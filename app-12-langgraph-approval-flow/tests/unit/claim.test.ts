import { describe, expect, it, vi } from 'vitest'
import { CLAIM_TTL_MS, claimThread, isClaimed, releaseClaim } from '../../netlify/shared/claim'
import { createMemoryStore, type KeyValueStore } from '../../netlify/shared/store'

const THREAD = '019c6a1b-2c3d-7e8f-8b7a-1c2d3e4f5a6b'
const T0 = 1_800_000_000_000

/** A store whose calls wait a random few milliseconds, so racing callers really interleave. */
function jittery(inner: KeyValueStore): KeyValueStore {
  const wait = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 10))
  return {
    ...inner,
    get: async (key) => (await wait(), inner.get(key)),
    setIfNew: async (key, value) => (await wait(), inner.setIfNew(key, value)),
    getTagged: async (key) => (await wait(), inner.getTagged(key)),
    setIfMatch: async (key, value, etag) => (await wait(), inner.setIfMatch(key, value, etag)),
  }
}

describe('the memory store conditional writes', () => {
  it('setIfNew writes once, getTagged changes its tag on every write, and setIfMatch needs the current tag', async () => {
    const store = createMemoryStore()
    expect(await store.setIfNew('k', 'a')).toBe(true)
    expect(await store.setIfNew('k', 'b')).toBe(false)
    const first = await store.getTagged('k')
    expect(first?.value).toBe('a')
    await store.set('k', 'c')
    const second = await store.getTagged('k')
    expect(second?.etag).not.toBe(first?.etag)
    expect(await store.setIfMatch('k', 'd', first?.etag ?? '')).toBe(false)
    expect(await store.setIfMatch('k', 'd', second?.etag ?? '')).toBe(true)
    expect(await store.get('k')).toBe('d')
    expect(await store.setIfMatch('missing', 'x', '1')).toBe(false)
    expect(await store.getTagged('missing')).toBeUndefined()
  })
})

describe('claimThread', () => {
  it('gives the claim to the first caller and refuses the second while it is held', async () => {
    const store = createMemoryStore()
    const first = await claimThread(store, THREAD, T0)
    expect(first).toMatchObject({ threadId: THREAD })
    expect(await claimThread(store, THREAD, T0 + 1_000)).toBeNull()
    expect(await isClaimed(store, THREAD, T0 + 1_000)).toBe(true)
  })

  it('lets exactly one of ten callers racing at the same moment win', async () => {
    const store = jittery(createMemoryStore())
    const results = await Promise.all(Array.from({ length: 10 }, () => claimThread(store, THREAD, T0)))
    expect(results.filter((claim) => claim !== null)).toHaveLength(1)
  })

  it('frees the thread when the owner releases the claim', async () => {
    const store = createMemoryStore()
    const claim = await claimThread(store, THREAD, T0)
    await releaseClaim(store, claim as NonNullable<typeof claim>)
    expect(await isClaimed(store, THREAD, T0)).toBe(false)
    expect(await claimThread(store, THREAD, T0 + 1)).not.toBeNull()
  })

  it('keeps a claim while it is younger than the TTL, and takes it over once it is older', async () => {
    const store = createMemoryStore()
    await claimThread(store, THREAD, T0)
    expect(CLAIM_TTL_MS).toBe(60_000)
    expect(await claimThread(store, THREAD, T0 + CLAIM_TTL_MS - 1)).toBeNull()
    const taken = await claimThread(store, THREAD, T0 + CLAIM_TTL_MS)
    expect(taken).not.toBeNull()
    expect(await isClaimed(store, THREAD, T0 + CLAIM_TTL_MS + 1)).toBe(true)
  })

  it('lets exactly one of several callers racing to take over an expired claim win', async () => {
    const inner = createMemoryStore()
    await claimThread(inner, THREAD, T0)
    const store = jittery(inner)
    const results = await Promise.all(Array.from({ length: 8 }, () => claimThread(store, THREAD, T0 + 5 * CLAIM_TTL_MS)))
    expect(results.filter((claim) => claim !== null)).toHaveLength(1)
  })

  it('treats an unreadable claim as expired', async () => {
    const store = createMemoryStore()
    await store.set(`claims/${THREAD}`, '{not json')
    expect(await isClaimed(store, THREAD, T0)).toBe(false)
    expect(await claimThread(store, THREAD, T0)).not.toBeNull()
  })

  it('does not remove a claim that was taken over after this owner crashed and came back', async () => {
    const store = createMemoryStore()
    const slow = await claimThread(store, THREAD, T0)
    const successor = await claimThread(store, THREAD, T0 + 2 * CLAIM_TTL_MS)
    expect(successor).not.toBeNull()

    await releaseClaim(store, slow as NonNullable<typeof slow>)

    expect(await isClaimed(store, THREAD, T0 + 2 * CLAIM_TTL_MS + 1)).toBe(true)
  })

  it('never throws when the release fails, and logs it with the thread id', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const inner = createMemoryStore()
    const claim = await claimThread(inner, THREAD, T0)
    const broken: KeyValueStore = { ...inner, get: () => Promise.reject(new Error('blobs down')) }
    await expect(releaseClaim(broken, claim as NonNullable<typeof claim>)).resolves.toBeUndefined()
    expect(String(error.mock.calls[0][0])).toContain(THREAD)
    error.mockRestore()
  })
})
