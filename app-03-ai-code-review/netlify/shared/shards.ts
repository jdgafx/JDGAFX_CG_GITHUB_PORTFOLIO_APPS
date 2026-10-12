import type { DiffUnit } from './diff'

// Pass 1 is split into parallel requests by line range, so no single request has more to write than it can finish inside its
// time limit. Each shard reviews only its own range and is given the whole numbered file as read-only context, so an issue that
// spans ranges is still visible. This file is pure and shared: the browser plans the shards to know how many requests to send,
// and the server plans them again from the same input and refuses a request that disagrees.

/** A file larger than this many lines is reviewed in more than one shard. Source: see budget.ts (SHARD_MAX_TOKENS). */
export const SHARD_LINES = 200
/** A pull request with more changed lines than this is reviewed in more than one shard. */
export const SHARD_CHANGED = 120
/** Most shards one review makes. The size limit (50,000 characters) means a larger review is refused, not cut. */
export const MAX_SHARDS = 8
/** How far (in numbered lines) from an even split a boundary may move to land on a blank line, a top-level statement or a file header. */
const FILE_WINDOW = 25
const DIFF_WINDOW = 60

export interface Shard {
  index: number
  /** First and last numbered line of the range, both included. */
  from: number
  to: number
  /** How many comments this shard is asked for: its share of the review's budget. */
  budget: number
}

const indentOf = (text: string) => text.length - text.trimStart().length

/**
 * Where a shard may start, best first. In a file: a top-level statement after a blank line, then any line after a blank line,
 * then any top-level line, then anything. Starting on a top-level line is the stand-in for "not in the middle of a statement".
 */
function fileScore(texts: readonly string[], start: number): number {
  const here = texts[start - 1] ?? ''
  const before = texts[start - 2] ?? ''
  const topLevel = here.trim() !== '' && indentOf(here) === 0
  if (before.trim() === '' && topLevel) return 3
  if (before.trim() === '' || here.trim() === '') return 2
  return topLevel ? 1 : 0
}

/** A diff boundary: a file header best, then a hunk header, then anything. */
function diffScore(units: readonly DiffUnit[], start: number): number {
  const unit = units[start - 1]
  if (!unit || unit.kind !== 'meta') return 0
  return unit.shown.startsWith('===') ? 3 : 2
}

/** The start lines of shards 2..count: each as near its even split as it can be while the score is best. */
function boundaries(size: number, count: number, window: number, ideal: (k: number) => number, score: (start: number) => number): number[] {
  const starts: number[] = []
  let previous = 1
  for (let k = 1; k < count; k += 1) {
    const target = ideal(k)
    let best = Math.min(Math.max(target, previous + 1), size - (count - k))
    let bestScore = -1
    for (let d = 0; d <= window; d += 1) {
      for (const candidate of d === 0 ? [target] : [target + d, target - d]) {
        if (candidate <= previous || candidate > size - (count - k)) continue
        const s = score(candidate)
        if (s > bestScore) {
          best = candidate
          bestScore = s
        }
      }
    }
    starts.push(best)
    previous = best
  }
  return starts
}

/** Splits `total` comments over the shards in proportion to their size, at least one each, none lost to rounding. */
function budgets(sizes: readonly number[], total: number): number[] {
  const whole = sizes.reduce((a, b) => a + b, 0) || 1
  const exact = sizes.map((s) => (total * s) / whole)
  const out = exact.map((e) => Math.max(1, Math.floor(e)))
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0])
  for (let i = 0; left > 0 && order.length > 0; i = (i + 1) % order.length, left -= 1) out[order[i][1]] += 1
  return out
}

/**
 * The shards of a review. `texts` are the numbered lines; `units` is the numbered diff for a pull request, or null for a file;
 * `total` is the comment budget of the whole review. A small file or diff is one shard, the whole of it.
 */
export function planShards(texts: readonly string[], units: readonly DiffUnit[] | null, total: number): Shard[] {
  const size = texts.length
  const changed = units ? units.filter((u) => u.kind === 'add' || u.kind === 'del').length : size
  const per = units ? SHARD_CHANGED : SHARD_LINES
  const count = Math.min(MAX_SHARDS, Math.max(1, Math.ceil(changed / per)), Math.max(1, size))
  let starts: number[]
  if (count === 1) starts = []
  else if (!units) starts = boundaries(size, count, FILE_WINDOW, (k) => Math.round((k * size) / count) + 1, (s) => fileScore(texts, s))
  else {
    // Balance by changed lines: the k-th boundary is where the running count of changed lines reaches k / count of the total.
    const upTo: number[] = []
    let running = 0
    for (const u of units) upTo.push((running += u.kind === 'add' || u.kind === 'del' ? 1 : 0))
    const at = (k: number) => Math.max(2, upTo.findIndex((c) => c >= (k * changed) / count) + 1)
    starts = boundaries(size, count, DIFF_WINDOW, at, (s) => diffScore(units, s))
  }
  const edges = [1, ...starts, size + 1]
  const ranges = edges.slice(0, -1).map((from, i) => ({ from, to: edges[i + 1] - 1 }))
  const share = budgets(ranges.map((r) => r.to - r.from + 1), total)
  return ranges.map((r, index) => ({ index, from: r.from, to: r.to, budget: share[index] }))
}

const normal = (text: unknown) => (typeof text === 'string' ? text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60) : '')

/**
 * The comments a shard wrote for its own range. One that cites a line outside it is left out: the shard that owns that line
 * reviews it, and a model that cites outside its range is the cause of the same finding being made twice. An item with no
 * numeric line is kept: the checks count it as unreadable.
 */
export function withinRange(comments: readonly unknown[], shard: Pick<Shard, 'from' | 'to'>): { kept: unknown[]; outside: number } {
  const kept = comments.filter((item) => {
    const line = item && typeof item === 'object' ? (item as { line?: unknown }).line : undefined
    return typeof line !== 'number' || (Math.round(line) >= shard.from && Math.round(line) <= shard.to)
  })
  return { kept, outside: comments.length - kept.length }
}

/**
 * Joins the comments the shards wrote, in shard order, dropping a comment that another already made: the same cited line and the
 * same opening of the message. An item that is not an object is kept as it is: the checks count it as unreadable.
 */
export function mergeComments(lists: ReadonlyArray<readonly unknown[]>): { comments: unknown[]; duplicates: number } {
  const seen = new Set<string>()
  const comments: unknown[] = []
  let duplicates = 0
  for (const item of lists.flat()) {
    const c = item && typeof item === 'object' ? (item as { line?: unknown; message?: unknown }) : null
    const key = c && typeof c.line === 'number' ? `${Math.round(c.line)}|${normal(c.message)}` : null
    if (key !== null && seen.has(key)) {
      duplicates += 1
      continue
    }
    if (key !== null) seen.add(key)
    comments.push(item)
  }
  return { comments, duplicates }
}
