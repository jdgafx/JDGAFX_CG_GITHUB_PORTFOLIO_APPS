import { beforeEach, describe, expect, it, vi } from 'vitest'

const blobs = vi.hoisted(() => ({ getStore: vi.fn() }))

vi.mock('@netlify/blobs', () => ({ getStore: blobs.getStore }))

import { CHECKPOINT_STORE_NAME, createStore } from '../../netlify/shared/store'

/** A Blobs-shaped fake: text values by key, and list pages of two keys each. */
function fakeBlobStore() {
  const values = new Map<string, string>()
  return {
    values,
    async get(key: string) {
      return values.has(key) ? (values.get(key) as string) : null
    },
    async set(key: string, value: string) {
      values.set(key, value)
      return { modified: true }
    },
    async delete(key: string) {
      values.delete(key)
    },
    list(options: { prefix?: string; paginate?: boolean }) {
      const keys = [...values.keys()].filter((key) => key.startsWith(options.prefix ?? ''))
      return (async function* pages() {
        for (let i = 0; i < keys.length; i += 2) {
          yield { blobs: keys.slice(i, i + 2).map((key) => ({ key, etag: 'e' })), directories: [] }
        }
      })()
    },
  }
}

describe('createStore', () => {
  beforeEach(() => {
    blobs.getStore.mockReset()
  })

  it('uses Netlify Blobs with strong consistency when the function context exists', async () => {
    const fake = fakeBlobStore()
    blobs.getStore.mockReturnValue(fake)

    const { store, kind } = createStore()

    expect(kind).toBe('blobs')
    expect(blobs.getStore).toHaveBeenCalledWith({ name: CHECKPOINT_STORE_NAME, consistency: 'strong' })
    expect(CHECKPOINT_STORE_NAME).toBe('graphgate-checkpoints')

    await store.set('thread/a/latest', 'x1')
    await store.set('thread/a/checkpoint/x1', '{}')
    await store.set('thread/b/latest', 'y1')
    expect(await store.get('thread/a/latest')).toBe('x1')
    expect(await store.get('missing')).toBeUndefined()
    expect(await store.list('thread/a/')).toEqual(['thread/a/latest', 'thread/a/checkpoint/x1'])
    await store.delete('thread/a/latest')
    expect(await store.get('thread/a/latest')).toBeUndefined()
  })

  it('falls back to an in-memory store when Blobs has no site context', async () => {
    blobs.getStore.mockImplementation(() => {
      throw new Error('MissingBlobsEnvironmentError')
    })

    const { store, kind } = createStore()

    expect(kind).toBe('memory')
    await store.set('k', 'v')
    expect(await store.get('k')).toBe('v')
    expect(await store.list('k')).toEqual(['k'])
  })
})
