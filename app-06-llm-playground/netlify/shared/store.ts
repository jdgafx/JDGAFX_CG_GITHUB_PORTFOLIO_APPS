import { getStore } from '@netlify/blobs'

/** The Netlify Blobs store that holds blind runs and the leaderboard. */
export const ARENA_STORE_NAME = 'modelarena-arena'

/** A value and the tag that changes whenever it is written. A conditional write names the tag it read. */
export interface Tagged {
  value: string
  etag: string
}

/**
 * The operations the arena needs. Values are UTF-8 text.
 * The two conditional writes are atomic in the store: of several writers racing for one condition, one wins.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  /** Every key that starts with `prefix`. */
  list(prefix: string): Promise<string[]>
  /** Writes only when the key does not exist. True when this call wrote it. */
  setIfNew(key: string, value: string): Promise<boolean>
  /** The value with its tag, or undefined when the key does not exist. */
  getTagged(key: string): Promise<Tagged | undefined>
  /** Writes only when the key still has the tag that was read. True when this call wrote it. */
  setIfMatch(key: string, value: string, etag: string): Promise<boolean>
}

export type StorageKind = 'blobs' | 'memory'

interface OpenStore {
  store: KeyValueStore
  kind: StorageKind
}

/** The message for a store call that did not answer in time. */
export const STORE_SLOW = 'The vote store did not answer in time. Try again.'

/** The longest wait for one store call. A call that outlives it fails with STORE_SLOW. */
const STORE_CALL_MS = 8_000

export class StoreTimeoutError extends Error {
  constructor() {
    super(STORE_SLOW)
    this.name = 'StoreTimeoutError'
  }
}

/** The store timeout behind an error, found directly or as the cause of a wrapping error. */
export function storeTimeoutOf(err: unknown): StoreTimeoutError | undefined {
  if (err instanceof StoreTimeoutError) return err
  const cause = err instanceof Error ? err.cause : undefined
  return cause instanceof StoreTimeoutError ? cause : undefined
}

/** An in-memory store. Tests use it, and local development uses it when Blobs is not configured. */
export function createMemoryStore(): KeyValueStore {
  const values = new Map<string, string>()
  const tags = new Map<string, number>()
  let counter = 0
  const write = (key: string, value: string) => {
    values.set(key, value)
    counter += 1
    tags.set(key, counter)
  }
  return {
    async get(key) {
      return values.get(key)
    },
    async set(key, value) {
      write(key, value)
    },
    async delete(key) {
      values.delete(key)
      tags.delete(key)
    },
    async list(prefix) {
      return [...values.keys()].filter((key) => key.startsWith(prefix))
    },
    async setIfNew(key, value) {
      if (values.has(key)) return false
      write(key, value)
      return true
    },
    async getTagged(key) {
      const value = values.get(key)
      return value === undefined ? undefined : { value, etag: String(tags.get(key)) }
    },
    async setIfMatch(key, value, etag) {
      if (!values.has(key) || String(tags.get(key)) !== etag) return false
      write(key, value)
      return true
    },
  }
}

/** Netlify Blobs behind the same four operations. Strong consistency reads after writes. */
function blobsStore(): KeyValueStore {
  const blobs = getStore({ name: ARENA_STORE_NAME, consistency: 'strong' })
  return {
    async get(key) {
      const value: string | null = await blobs.get(key, { type: 'text' })
      return value ?? undefined
    },
    async set(key, value) {
      await blobs.set(key, value)
    },
    async delete(key) {
      await blobs.delete(key)
    },
    async list(prefix) {
      const keys: string[] = []
      for await (const page of blobs.list({ prefix, paginate: true })) {
        for (const blob of page.blobs) keys.push(blob.key)
      }
      return keys
    },
    async setIfNew(key, value) {
      return (await blobs.set(key, value, { onlyIfNew: true })).modified
    },
    async getTagged(key) {
      const found = await blobs.getWithMetadata(key, { type: 'text' })
      return found && found.etag ? { value: found.data, etag: found.etag } : undefined
    },
    async setIfMatch(key, value, etag) {
      return (await blobs.set(key, value, { onlyIfMatch: etag })).modified
    },
  }
}

/**
 * Picks Netlify Blobs when the function runs inside a Netlify environment. getStore throws
 * synchronously when the site context is missing, which is how local dev without Blobs looks.
 */
export function createStore(): OpenStore {
  try {
    return { store: blobsStore(), kind: 'blobs' }
  } catch {
    return { store: createMemoryStore(), kind: 'memory' }
  }
}

let active: OpenStore | undefined

/** The store for this process. It is chosen once, on first use. */
export function activeStore(): OpenStore {
  active ??= createStore()
  return active
}

/** Tests put their own store in place of the process store. */
export function useStoreForTests(store: KeyValueStore, kind: StorageKind = 'memory'): void {
  active = { store, kind }
}

/**
 * Waits for one store call. It settles with the call's own outcome, or with a StoreTimeoutError when
 * the wait passes `timeoutMs` or the signal aborts first. A call abandoned that way may still finish
 * later; its result is ignored.
 */
function bounded<T>(operation: Promise<T>, signal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  if (signal?.aborted) return Promise.reject(new StoreTimeoutError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => settle(() => reject(new StoreTimeoutError()))
    const timer = setTimeout(onAbort, timeoutMs)
    const settle = (finish: () => void) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      finish()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => settle(() => resolve(value)),
      (err: unknown) => settle(() => reject(err)),
    )
  })
}

/**
 * The same store with every call bounded. A call waits at most `timeoutMs`, and it is cut off at once
 * when `signal` aborts. A call that fails on its own keeps its own error.
 */
export function guardStore(store: KeyValueStore, signal?: AbortSignal, timeoutMs: number = STORE_CALL_MS): KeyValueStore {
  return {
    get: (key) => bounded(store.get(key), signal, timeoutMs),
    set: (key, value) => bounded(store.set(key, value), signal, timeoutMs),
    delete: (key) => bounded(store.delete(key), signal, timeoutMs),
    list: (prefix) => bounded(store.list(prefix), signal, timeoutMs),
    setIfNew: (key, value) => bounded(store.setIfNew(key, value), signal, timeoutMs),
    getTagged: (key) => bounded(store.getTagged(key), signal, timeoutMs),
    setIfMatch: (key, value, etag) => bounded(store.setIfMatch(key, value, etag), signal, timeoutMs),
  }
}
