import { PRIORITIES, type IssueInput, type Priority, type ThreadEntry, type ThreadStatus } from '../../src/types'
import type { KeyValueStore } from './store'

export const THREAD_INDEX_KEY = 'threads/index'
/** The index keeps this many threads. Threads still waiting for approval are never dropped. */
export const MAX_INDEXED_THREADS = 50
const TITLE_MAX_LENGTH = 70

/**
 * A row of the current shape. The refund version of this app kept rows with an amount and no repo or
 * priority. Those threads cannot be resumed by this graph, so they fail this check and are left out.
 */
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

function newestFirst(a: ThreadEntry, b: ThreadEntry): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
}

/**
 * The rows to keep, newest first. Every thread awaiting approval is kept, even past the cap, because
 * its checkpoint still needs an answer. Finished threads fill whatever room is left, oldest out first.
 */
export function keepIndexed(rows: readonly ThreadEntry[]): ThreadEntry[] {
  const sorted = [...rows].sort(newestFirst)
  const waiting = sorted.filter((row) => row.status === 'awaiting_approval')
  const finished = sorted.filter((row) => row.status !== 'awaiting_approval')
  const room = Math.max(0, MAX_INDEXED_THREADS - waiting.length)
  const kept = new Set<ThreadEntry>([...waiting, ...finished.slice(0, room)])
  return sorted.filter((row) => kept.has(row))
}

/** Every indexed thread, newest first. A damaged index reads as empty, and rows of an older shape are skipped. */
export async function readThreadIndex(store: KeyValueStore): Promise<ThreadEntry[]> {
  const raw = await store.get(THREAD_INDEX_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isEntry) : []
  } catch {
    return []
  }
}

export async function getThreadEntry(store: KeyValueStore, id: string): Promise<ThreadEntry | undefined> {
  return (await readThreadIndex(store)).find((entry) => entry.id === id)
}

/**
 * Writes one thread's row and stamps it. The read-then-write is not atomic: two writes at the same
 * moment can drop one row. Checkpoints are unaffected, and a dropped row only hides the thread.
 */
export async function upsertThread(
  store: KeyValueStore,
  change: { id: string; title: string; repo: string; number: number; status: ThreadStatus; priority: Priority | null },
  now: Date = new Date(),
): Promise<ThreadEntry> {
  const entry: ThreadEntry = { ...change, updatedAt: now.toISOString() }
  const others = (await readThreadIndex(store)).filter((existing) => existing.id !== change.id)
  await store.set(THREAD_INDEX_KEY, JSON.stringify(keepIndexed([entry, ...others])))
  return entry
}

/** A short list title: the repo, the issue number and the title, cut to 70 characters. */
export function titleFor(issue: Pick<IssueInput, 'repo' | 'number' | 'title'>): string {
  const line = `${issue.repo} #${issue.number}: ${issue.title}`.replace(/\s+/g, ' ').trim()
  return line.length > TITLE_MAX_LENGTH ? `${line.slice(0, TITLE_MAX_LENGTH - 3).trimEnd()}...` : line
}
