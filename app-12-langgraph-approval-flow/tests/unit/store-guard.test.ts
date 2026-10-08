import { describe, expect, it } from 'vitest'
import { createMemoryStore, guardStore, STORE_SLOW, StoreTimeoutError, type KeyValueStore } from '../../netlify/shared/store'

const NEVER = () => new Promise<never>(() => {})
const hanging: KeyValueStore = { get: NEVER, set: NEVER, delete: NEVER, list: NEVER }

describe('guardStore', () => {
  it('passes results through unchanged', async () => {
    const store = guardStore(createMemoryStore())
    await store.set('thread/a/latest', 'x1')
    expect(await store.get('thread/a/latest')).toBe('x1')
    expect(await store.list('thread/a/')).toEqual(['thread/a/latest'])
    await store.delete('thread/a/latest')
    expect(await store.get('thread/a/latest')).toBeUndefined()
  })

  it('keeps a store error as the store raised it', async () => {
    const failing: KeyValueStore = { ...hanging, get: () => Promise.reject(new Error('blobs unavailable')) }
    await expect(guardStore(failing).get('k')).rejects.toThrow('blobs unavailable')
  })

  it('gives up after the per-call limit with the plain message', async () => {
    const pending = guardStore(hanging, undefined, 5).set('k', 'v')
    await expect(pending).rejects.toBeInstanceOf(StoreTimeoutError)
    await expect(pending).rejects.toThrow(STORE_SLOW)
  })

  it('refuses at once when the budget has already run out', async () => {
    const budget = new AbortController()
    budget.abort()
    await expect(guardStore(hanging, budget.signal).get('k')).rejects.toBeInstanceOf(StoreTimeoutError)
  })

  it('cuts a waiting call off when the budget runs out during it', async () => {
    const budget = new AbortController()
    const pending = guardStore(hanging, budget.signal).get('k')
    budget.abort()
    await expect(pending).rejects.toBeInstanceOf(StoreTimeoutError)
  })
})
