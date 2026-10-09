import { PRIORITIES, type IssueInput, type Priority, type ThreadEntry, type ThreadStatus } from '../../src/types'
import type { KeyValueStore } from './store'

/**
 * Thread summaries, one small blob per thread at `threads/<threadId>`. Each is written only by the run that
 * owns its thread, so two runs never write the same key and nothing is read, changed and written back as a
 * shared object. The summary is a convenience for the list: the thread's checkpoint is the source of truth.
 */
export const SUMMARY_PREFIX = 'threads/'
/** The single index document of earlier versions. It is read as a fallback for listing and never written. */
export const LEGACY_INDEX_KEY = 'threads/index'
/** The list shows this many threads, the newest first. */
export const MAX_LISTED_THREADS = 50
const TITLE_MAX_LENGTH = 70

const THREAD_KEY = /^threads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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

const summaryKey = (id: string) => `${SUMMARY_PREFIX}${id}`

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

/** Writes one thread's summary and stamps it. One key per thread, so concurrent runs cannot overwrite each other. */
export async function writeThread(
  store: KeyValueStore,
  change: { id: string; title: string; repo: string; number: number; status: ThreadStatus; priority: Priority | null },
  now: Date = new Date(),
): Promise<ThreadEntry> {
  const entry: ThreadEntry = { ...change, updatedAt: now.toISOString() }
  await store.set(summaryKey(change.id), JSON.stringify(entry))
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
  return parseEntry(await store.get(summaryKey(id))) ?? (await readLegacyIndex(store)).find((entry) => entry.id === id)
}

/**
 * The newest 50 threads, newest first. Keys are listed and the newest are read, so the cost does not grow
 * with the number of threads ever saved beyond the key listing itself. Threads that only the legacy index
 * knows are merged in, so threads saved before summaries existed stay reachable. A summary that cannot be
 * read is skipped.
 */
export async function listThreads(store: KeyValueStore): Promise<ThreadEntry[]> {
  const keys = (await store.list(SUMMARY_PREFIX)).filter((key) => THREAD_KEY.test(key)).sort().reverse()
  const rows = await Promise.all(keys.slice(0, MAX_LISTED_THREADS).map(async (key) => parseEntry(await store.get(key))))
  const known = new Set(keys)
  const legacy = (await readLegacyIndex(store)).filter((entry) => !known.has(summaryKey(entry.id)))
  return [...rows.filter((row): row is ThreadEntry => row !== undefined), ...legacy]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, MAX_LISTED_THREADS)
}

/** A short list title: the repo, the issue number and the title, cut to 70 characters. */
export function titleFor(issue: Pick<IssueInput, 'repo' | 'number' | 'title'>): string {
  const line = `${issue.repo} #${issue.number}: ${issue.title}`.replace(/\s+/g, ' ').trim()
  return line.length > TITLE_MAX_LENGTH ? `${line.slice(0, TITLE_MAX_LENGTH - 3).trimEnd()}...` : line
}
