import { PRIORITIES, type IssueInput, type Priority, type ThreadEntry, type ThreadStatus } from '../../src/types'
import type { KeyValueStore } from './store'

/**
 * Thread summaries, one small blob per thread. Each is written only by the run that owns its thread, so two
 * runs never write the same key and nothing is read, changed and written back as a shared object. The summary
 * is a convenience for the list: the thread's checkpoint is the source of truth.
 *
 * Keys. A thread id that starts with the creation time (see newThreadId) is its own sort key: `threads/<id>`.
 * A thread with a random id, saved before ids carried the time, is stored at `threads/<time>-<id>`, where the
 * time is when its summary was first written. Either way the keys sort by recency, so "the newest 50" can be
 * chosen from the key listing alone. A thread that is waiting for a maintainer also has an empty marker at
 * `waiting/<id>`, so the list can show waiting threads first without reading every summary.
 */
export const SUMMARY_PREFIX = 'threads/'
export const WAITING_PREFIX = 'waiting/'
/** The single index document of earlier versions. It is read as a fallback for listing and never written. */
export const LEGACY_INDEX_KEY = 'threads/index'
/** The list shows this many threads: waiting ones first, then the newest. */
export const MAX_LISTED_THREADS = 50
/** At most this many summaries are read at once, so a list call does not flood the store. */
const READ_CONCURRENCY = 8
/** The list stops starting reads after this long and returns what it has read. */
const LIST_BUDGET_MS = 6_000
const TITLE_MAX_LENGTH = 70

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ID_KEY = new RegExp(`^threads/(${UUID})$`)
const ALIASED_KEY = new RegExp(`^threads/[0-9a-f]{8}-[0-9a-f]{4}-(${UUID})$`)

/** True for an id made by newThreadId: the version digit 7 marks the layout that starts with the time. */
export const startsWithTime = (id: string) => id[14] === '7'

/**
 * A new thread id: a UUID whose first 48 bits are the time in milliseconds, then random bits (the
 * UUID v7 layout). Ids sort by creation time, so the newest threads are the last keys in a listing.
 */
export function newThreadId(now: Date = new Date()): string {
  const time = now.getTime().toString(16).padStart(12, '0')
  const random = crypto.getRandomValues(new Uint8Array(10))
  const hex = Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('')
  const variant = (0x8 | (random[2] & 0x3)).toString(16)
  return `${time.slice(0, 8)}-${time.slice(8)}-7${hex.slice(0, 3)}-${variant}${hex.slice(3, 6)}-${hex.slice(6, 18)}`
}

/**
 * The thread id a summary key stands for, or null when the key is not one the list uses: the legacy index
 * document, or a plain `threads/<id>` of a thread whose random id carries no time. An earlier version wrote
 * such plain keys. They cannot be ordered by key, so the list ignores them, and a write migrates them.
 */
function idOfKey(key: string): string | null {
  const plain = ID_KEY.exec(key)?.[1]
  if (plain !== undefined) return startsWithTime(plain) ? plain : null
  return ALIASED_KEY.exec(key)?.[1] ?? null
}

/**
 * The key where a thread's summary is, or would be written. A thread with a random id is found by its key
 * listing; one that has none yet gets a key that starts with the time of this first write.
 */
async function keyFor(store: KeyValueStore, id: string, now: Date = new Date()): Promise<string> {
  if (startsWithTime(id)) return `${SUMMARY_PREFIX}${id}`
  const found = (await store.list(SUMMARY_PREFIX)).find((key) => ALIASED_KEY.exec(key)?.[1] === id)
  if (found) return found
  const time = now.getTime().toString(16).padStart(12, '0')
  return `${SUMMARY_PREFIX}${time.slice(0, 8)}-${time.slice(8)}-${id}`
}

/** Messages of an error and of its causes, so a log line shows what the store really said. */
export function describeError(err: unknown): string {
  const parts: string[] = []
  for (let current: unknown = err, depth = 0; current !== undefined && depth < 4; depth += 1) {
    parts.push(current instanceof Error ? `${current.name}: ${current.message}` : String(current))
    current = current instanceof Error ? current.cause : undefined
  }
  return parts.join(' <- ')
}

/** A summary of the current shape. Rows of the refund version have an amount and no repo or priority, and fail this. */
function isEntry(value: unknown): value is ThreadEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.repo === 'string' &&
    typeof entry.number === 'number' &&
    typeof entry.updatedAt === 'string' &&
    (entry.status === 'awaiting_approval' || entry.status === 'completed' || entry.status === 'failed') &&
    (entry.priority === null || PRIORITIES.includes(entry.priority as Priority))
  )
}

function parseEntry(raw: string | undefined): ThreadEntry | undefined {
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return isEntry(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Writes one thread's summary and stamps it, and keeps the waiting marker in step: present while the thread
 * awaits a maintainer, removed otherwise. A marker that cannot be written is logged and does not fail the write.
 */
export async function writeThread(
  store: KeyValueStore,
  change: { id: string; title: string; repo: string; number: number; status: ThreadStatus; priority: Priority | null },
  now: Date = new Date(),
): Promise<ThreadEntry> {
  const entry: ThreadEntry = { ...change, updatedAt: now.toISOString() }
  await store.set(await keyFor(store, change.id, now), JSON.stringify(entry))
  // A plain `threads/<id>` of a random id was written by an earlier version. The summary now lives at its
  // time-ordered key, so the old copy goes, and the thread is listed once.
  if (!startsWithTime(change.id)) {
    try {
      await store.delete(`${SUMMARY_PREFIX}${change.id}`)
    } catch (err) {
      console.error(`GraphGate: could not remove the old summary of thread ${change.id}: ${describeError(err)}`)
    }
  }
  try {
    if (change.status === 'awaiting_approval') await store.set(`${WAITING_PREFIX}${change.id}`, '1')
    else await store.delete(`${WAITING_PREFIX}${change.id}`)
  } catch (err) {
    console.error(`GraphGate: could not update the waiting marker of thread ${change.id}: ${describeError(err)}`)
  }
  return entry
}

/** The rows of the single index document of earlier versions, current shape only. Damaged or missing reads as none. */
async function readLegacyIndex(store: KeyValueStore): Promise<ThreadEntry[]> {
  // The read is outside the try: a store that fails or times out must fail the call, not read as an empty index.
  const raw = (await store.get(LEGACY_INDEX_KEY)) ?? '[]'
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isEntry) : []
  } catch {
    return []
  }
}

/** One thread's summary, or undefined. Falls back to the legacy index for a thread saved before summaries existed. */
export async function getThreadEntry(store: KeyValueStore, id: string): Promise<ThreadEntry | undefined> {
  const key = await keyFor(store, id)
  const own = parseEntry(await store.get(key))
  if (own) return own
  // A random id may still have its summary at the plain key an earlier version used.
  const plain = startsWithTime(id) ? undefined : parseEntry(await store.get(`${SUMMARY_PREFIX}${id}`))
  return plain ?? (await readLegacyIndex(store)).find((entry) => entry.id === id)
}

/** Runs `work` over `items`, at most `limit` at a time, and starts no new item after `deadline`. */
async function mapBounded<T, R>(items: readonly T[], limit: number, deadline: number, work: (item: T) => Promise<R>): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length).fill(undefined)
  let next = 0
  const worker = async () => {
    while (next < items.length && Date.now() < deadline) {
      const index = next
      next += 1
      results[index] = await work(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** At most this many plain legacy summaries are read per list call, and at most this many are moved. */
const MAX_PLAIN_READS = 30
const MAX_MIGRATIONS_PER_LIST = 5

/** True when the thread has a waiting marker. The marker is what the list trusts for "waiting". */
export async function hasWaitingMarker(store: KeyValueStore, id: string): Promise<boolean> {
  return (await store.get(`${WAITING_PREFIX}${id}`)) !== undefined
}

/**
 * Moves one plain `threads/<random id>` summary to its time-ordered key, keeping its own update time as
 * the time in the key and in the row. It adds no waiting marker: whether the thread waits is not known
 * here. Idempotent: the key is derived from the row, so two calls write the same key.
 */
async function migratePlainSummary(store: KeyValueStore, entry: ThreadEntry): Promise<void> {
  const time = Date.parse(entry.updatedAt)
  if (!Number.isFinite(time)) return
  const hex = time.toString(16).padStart(12, '0')
  await store.set(`${SUMMARY_PREFIX}${hex.slice(0, 8)}-${hex.slice(8)}-${entry.id}`, JSON.stringify(entry))
  await store.delete(`${SUMMARY_PREFIX}${entry.id}`)
}

export interface ThreadList {
  rows: ThreadEntry[]
  /** Rows that say "awaiting a maintainer" but have no waiting marker, so the list does not trust them. */
  stale: string[]
}

/**
 * The threads to show, at most 50: waiting threads first, then the newest. The key listing picks which
 * summaries to read (the waiting markers first, then the newest keys), and they are read a few at a time.
 * One summary that cannot be read costs one row: it is logged with its key and skipped. When every read
 * fails, the first error is thrown, so a store that is down reads as down and not as an empty list. A list
 * that runs past its time budget returns the rows read so far.
 *
 * Threads of earlier versions are merged in: the legacy index rows, and the plain `threads/<random id>`
 * summaries, which are read so the newer copy wins, and of which a few are moved to time-ordered keys on
 * each call until none are left. One row per thread, the newest copy winning, sorted by update time before
 * the cap. A row counts as waiting only if the thread's waiting marker exists. A row that says waiting
 * without a marker is listed as stale, and the caller checks it against its checkpoint.
 */
export async function listThreadsDetailed(store: KeyValueStore): Promise<ThreadList> {
  let allKeys: string[]
  try {
    allKeys = await store.list(SUMMARY_PREFIX)
  } catch (err) {
    console.error(`GraphGate: could not list the thread summaries: ${describeError(err)}`)
    throw err
  }
  const keys = allKeys.filter((key) => idOfKey(key) !== null).sort().reverse()
  const plainKeys = allKeys.filter((key) => {
    const id = ID_KEY.exec(key)?.[1]
    return id !== undefined && !startsWithTime(id)
  })
  const keyOfId = new Map(keys.map((key) => [idOfKey(key) as string, key]))

  let waitingIds: Set<string> | null = null
  let waitingKeys: string[] = []
  try {
    const markers = (await store.list(WAITING_PREFIX)).map((marker) => marker.slice(WAITING_PREFIX.length))
    waitingIds = new Set(markers)
    waitingKeys = markers
      .map((id) => keyOfId.get(id))
      .filter((key): key is string => key !== undefined)
      .sort()
      .reverse()
  } catch (err) {
    console.error(`GraphGate: could not list the waiting markers: ${describeError(err)}`)
  }
  const chosen = [...new Set([...waitingKeys, ...keys])].slice(0, MAX_LISTED_THREADS)
  const plainChosen = plainKeys.slice(0, MAX_PLAIN_READS)

  const failures: unknown[] = []
  const deadline = Date.now() + LIST_BUDGET_MS
  const readKey = async (key: string) => {
    try {
      return parseEntry(await store.get(key)) ?? null
    } catch (err) {
      failures.push(err)
      console.error(`GraphGate: could not read the thread summary ${key}: ${describeError(err)}`)
      return null
    }
  }
  const read = await mapBounded([...chosen, ...plainChosen], READ_CONCURRENCY, deadline, readKey)
  const attempted = read.filter((row) => row !== undefined)
  const found = read.filter((row): row is ThreadEntry => row !== undefined && row !== null)
  if (found.length === 0 && failures.length > 0 && failures.length === attempted.length) throw failures[0]
  if (read.some((row) => row === undefined)) console.error('GraphGate: the thread list ran out of time and shows the rows read so far')

  let legacy: ThreadEntry[] = []
  try {
    legacy = (await readLegacyIndex(store)).filter((entry) => !keyOfId.has(entry.id))
  } catch (err) {
    console.error(`GraphGate: could not read the legacy thread index: ${describeError(err)}`)
  }

  // One row per thread, the newest copy winning.
  const newest = new Map<string, ThreadEntry>()
  for (const row of [...found, ...legacy]) {
    const seen = newest.get(row.id)
    if (!seen || row.updatedAt > seen.updatedAt) newest.set(row.id, row)
  }
  const stale: string[] = []
  const isWaiting = (row: ThreadEntry) => {
    if (row.status !== 'awaiting_approval') return false
    if (waitingIds === null || waitingIds.has(row.id)) return true
    if (!stale.includes(row.id)) stale.push(row.id)
    return false
  }
  const rows = [...newest.values()]
    .map((row) => ({ row, waiting: isWaiting(row) }))
    .sort((a, b) => Number(b.waiting) - Number(a.waiting) || (a.row.updatedAt < b.row.updatedAt ? 1 : a.row.updatedAt > b.row.updatedAt ? -1 : 0))
    .slice(0, MAX_LISTED_THREADS)
    .map(({ row }) => row)

  // Empty the plain-key path a few at a time, so the legacy path goes away over time.
  const plainByKey = new Map(plainChosen.map((key, i) => [key, read[chosen.length + i]]))
  await Promise.all(
    [...plainByKey]
      .filter((entry): entry is [string, ThreadEntry] => entry[1] !== undefined && entry[1] !== null)
      .slice(0, MAX_MIGRATIONS_PER_LIST)
      .map(async ([, entry]) => {
        try {
          // A time-ordered summary already exists for this thread: it is newer, so the plain copy is just removed.
          if (keyOfId.has(entry.id)) await store.delete(`${SUMMARY_PREFIX}${entry.id}`)
          else await migratePlainSummary(store, entry)
        } catch (err) {
          console.error(`GraphGate: could not move the old summary of thread ${entry.id}: ${describeError(err)}`)
        }
      }),
  )
  return { rows, stale: stale.filter((id) => rows.some((row) => row.id === id)) }
}

/** The list rows only. See listThreadsDetailed. */
export async function listThreads(store: KeyValueStore): Promise<ThreadEntry[]> {
  return (await listThreadsDetailed(store)).rows
}

/** A short list title: the repo, the issue number and the title, cut to 70 characters. */
export function titleFor(issue: Pick<IssueInput, 'repo' | 'number' | 'title'>): string {
  const line = `${issue.repo} #${issue.number}: ${issue.title}`.replace(/\s+/g, ' ').trim()
  return line.length > TITLE_MAX_LENGTH ? `${line.slice(0, TITLE_MAX_LENGTH - 3).trimEnd()}...` : line
}
