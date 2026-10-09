import { getStore } from '@netlify/blobs'

/** The Netlify Blobs store that holds checkpoints and the thread index. */
export const CHECKPOINT_STORE_NAME = 'graphgate-checkpoints'

/** The four operations the checkpointer and the thread index need. Values are UTF-8 text. */
export interface KeyValueStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  /** Every key that starts with `prefix`. */
  list(prefix: string): Promise<string[]>
}

export type StorageKind = 'blobs' | 'memory'

interface OpenStore {
  store: KeyValueStore
  kind: StorageKind
}

/** Shown in the page when checkpoints live in memory, so a reload can lose an approval. */
export const MEMORY_NOTICE =
  'Checkpoints are kept in memory on this server because Netlify Blobs is not configured here. An approval can be lost on reload.'

/** The message for a store call that did not answer in time. */
export const STORE_SLOW = 'The checkpoint store did not answer in time. Try again.'

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
  return {
    async get(key) {
      return values.get(key)
    },
    async set(key, value) {
      values.set(key, value)
    },
    async delete(key) {
      values.delete(key)
    },
    async list(prefix) {
      return [...values.keys()].filter((key) => key.startsWith(prefix))
    },
  }
}

/** Netlify Blobs behind the same four operations. Strong consistency reads after writes. */
function blobsStore(): KeyValueStore {
  const blobs = getStore({ name: CHECKPOINT_STORE_NAME, consistency: 'strong' })
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
  }
}
