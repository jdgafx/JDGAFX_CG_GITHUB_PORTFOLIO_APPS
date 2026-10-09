import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A stand-in for @netlify/blobs whose stores carry a token that expires: a store made before the latest
 * `expireTokens()` raises the same error the real client does ("Token expired"), until a new store is made.
 */
const shared = vi.hoisted(() => {
  const state = { epoch: 0, made: 0, values: new Map<string, string>(), failWith: null as Error | null }
  class BlobsInternalError extends Error {
    constructor(message: string) {
      super(`Netlify Blobs has generated an internal error (${message})`)
      this.name = 'BlobsInternalError'
    }
  }
  return { state, BlobsInternalError }
})

vi.mock('@netlify/blobs', () => ({
  getStore: () => {
    shared.state.made += 1
    const born = shared.state.epoch
    const check = () => {
      if (shared.state.failWith) throw shared.state.failWith
      if (born < shared.state.epoch) throw new shared.BlobsInternalError('Failed to decode token: Token expired')
    }
    return {
      get: async (key: string) => (check(), shared.state.values.get(key) ?? null),
      set: async (key: string, value: string) => (check(), shared.state.values.set(key, value), { modified: true }),
      delete: async (key: string) => (check(), void shared.state.values.delete(key)),
      getWithMetadata: async () => (check(), null),
      list: (options: { prefix?: string }) => {
        check()
        const keys = [...shared.state.values.keys()].filter((key) => key.startsWith(options.prefix ?? ''))
        return (async function* pages() {
          yield { blobs: keys.map((key) => ({ key, etag: 'e' })), directories: [] }
        })()
      },
    }
  },
}))

import threads from '../../netlify/functions/threads'
import { activeStore, createStore, isTokenExpired } from '../../netlify/shared/store'
import { getFrom } from '../helpers/http'

const expireTokens = () => {
  shared.state.epoch += 1
}

beforeEach(() => {
  shared.state.epoch = 0
  shared.state.made = 0
  shared.state.values.clear()
  shared.state.failWith = null
})

describe('a Blobs token that expires on a warm instance', () => {
  it('recognises the error by its message, also as a cause', () => {
    expect(isTokenExpired(new shared.BlobsInternalError('Failed to decode token: Token expired'))).toBe(true)
    expect(isTokenExpired(new Error('wrapper', { cause: new Error('Token expired') }))).toBe(true)
    expect(isTokenExpired(new Error('Netlify Blobs is down'))).toBe(false)
    expect(isTokenExpired('Token expired')).toBe(false)
  })

  it('makes a new store for every request, so no request carries an earlier token', () => {
    activeStore()
    activeStore()
    activeStore()
    expect(shared.state.made).toBe(3)
  })

  it('serves a request after the tokens of earlier ones expired', async () => {
    expect((await threads(getFrom('/api/threads', 'ip-token-1'))).status).toBe(200)
    expireTokens()
    expect((await threads(getFrom('/api/threads', 'ip-token-1'))).status).toBe(200)
    expireTokens()
    expect((await threads(getFrom('/api/threads', 'ip-token-1'))).status).toBe(200)
  })

  it('also recovers a store that went bad mid-life: it builds a new one and retries the call once', async () => {
    const { store } = createStore()
    await store.set('threads/x', 'one')
    expireTokens()
    // Every operation of the old store would now fail. The adapter rebuilds its store and carries on.
    expect(await store.get('threads/x')).toBe('one')
    expireTokens()
    expect(await store.list('threads/')).toEqual(['threads/x'])
    expireTokens()
    await store.delete('threads/x')
    expect(await store.get('threads/x')).toBeUndefined()
    expect(shared.state.made).toBe(4)
  })

  it('does not retry an error that is not an expired token', async () => {
    const { store } = createStore()
    shared.state.failWith = new shared.BlobsInternalError('Netlify Blobs is unavailable')
    await expect(store.get('k')).rejects.toThrow('unavailable')
    expect(shared.state.made).toBe(1)
  })

  it('gives up when a fresh store fails too, instead of looping', async () => {
    const { store } = createStore()
    shared.state.failWith = new shared.BlobsInternalError('Failed to decode token: Token expired')
    await expect(store.get('k')).rejects.toThrow('Token expired')
    expect(shared.state.made).toBe(2)
  })
})
