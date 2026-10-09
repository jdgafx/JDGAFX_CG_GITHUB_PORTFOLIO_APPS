import { randomInt, randomUUID } from 'node:crypto'
import {
  RUN_TTL_MS,
  SLOTS,
  type BlindAnswer,
  type BlindCompareResponse,
  type CompareResponse,
  type LeaderboardResponse,
  type PanelResult,
  type RatingChange,
  type Slot,
  type VoteChoice,
} from './contract'
import { applyBallot, rankRows, type Entry, type Outcome, type Ratings } from './elo'
import { summarise } from './measure'
import { panelStep } from './panel'
import { isRecord } from './parse'
import type { KeyValueStore, StorageKind } from './store'

// A blind run lives in the store under runs/<runId> until it is voted on or expires. The run id is
// opaque to the browser and starts with the time the run expires, so a sweep can drop old runs by key.
const RUN_PREFIX = 'runs/'
export const BOARD_KEY = 'leaderboard'
const BOARD_ATTEMPTS = 12
const SWEEP_EVERY_MS = 5 * 60_000
const SWEEP_MAX_DELETES = 20

export function newRunId(now: number = Date.now()): string {
  return `${now + RUN_TTL_MS}-${randomUUID()}`
}

const runKey = (runId: string) => `${RUN_PREFIX}${runId}`

export function runExpiry(runId: string): number {
  return Number(runId.slice(0, 13))
}

// ---- Shuffle and relabel -----------------------------------------------------------------------

/**
 * A random order of the three slots. order[i] is the real slot shown under label SLOTS[i].
 * `pick` returns an integer in [0, n) so a test can fix the shuffle.
 */
export function shuffleOrder(pick: (n: number) => number = randomInt): Slot[] {
  const order = [...SLOTS]
  for (let i = order.length - 1; i > 0; i--) {
    const j = pick(i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

/** The panels in the order the visitor saw them, each carrying the label it was shown under. */
export function displayPanels(panels: PanelResult[], order: Slot[]): PanelResult[] {
  return SLOTS.map((label, i) => {
    const real = panels.find(p => p.slot === order[i])
    if (!real) throw new Error(`No panel for slot ${order[i]}`)
    return { ...real, slot: label }
  })
}

/** The full compare response with panels, trace and summary under the shown labels. */
export function revealed(compare: CompareResponse, order: Slot[]): CompareResponse {
  const panels = displayPanels(compare.panels, order)
  return { ...compare, panels, trace: panels.map(panelStep), summary: summarise(panels), blind: false }
}

/** What the visitor may see before voting: the text, no model, no number that could name one. */
export function blindView(compare: CompareResponse, order: Slot[], expiresAt: number): BlindCompareResponse {
  const answers: BlindAnswer[] = displayPanels(compare.panels, order).map(p => ({
    label: p.slot,
    ok: p.ok,
    error: p.error,
    text: p.text,
    finishReason: p.finishReason,
  }))
  return { blind: true, runId: compare.runId, expiresAt: new Date(expiresAt).toISOString(), totalMs: compare.totalMs, answers }
}

// ---- Stored runs -------------------------------------------------------------------------------

export interface StoredRun {
  compare: CompareResponse
  order: Slot[]
}

export async function saveRun(store: KeyValueStore, run: StoredRun): Promise<void> {
  await store.set(runKey(run.compare.runId), JSON.stringify(run))
}

export type RunLookup = { ok: true; run: StoredRun } | { ok: false; reason: 'gone' }

/** The stored run, or "gone" when it is missing or past its expiry (an expired run is deleted). */
export async function loadRun(store: KeyValueStore, runId: string, now: number = Date.now()): Promise<RunLookup> {
  if (runExpiry(runId) <= now) {
    await store.delete(runKey(runId))
    return { ok: false, reason: 'gone' }
  }
  const raw = await store.get(runKey(runId))
  if (raw === undefined) return { ok: false, reason: 'gone' }
  try {
    const value: unknown = JSON.parse(raw)
    if (isRecord(value) && isRecord(value.compare) && Array.isArray(value.order)) {
      return { ok: true, run: value as unknown as StoredRun }
    }
  } catch {
    // An unreadable run counts as gone.
  }
  return { ok: false, reason: 'gone' }
}

export async function dropRun(store: KeyValueStore, runId: string): Promise<void> {
  await store.delete(runKey(runId))
}

let lastSweep = 0

/** Deletes runs that expired without a vote. Best effort, at most every few minutes, and never throws. */
export async function sweepRuns(store: KeyValueStore, now: number = Date.now()): Promise<number> {
  if (now - lastSweep < SWEEP_EVERY_MS) return 0
  lastSweep = now
  let removed = 0
  try {
    for (const key of await store.list(RUN_PREFIX)) {
      if (removed >= SWEEP_MAX_DELETES) break
      if (Number(key.slice(RUN_PREFIX.length, RUN_PREFIX.length + 13)) <= now) {
        await store.delete(key)
        removed += 1
      }
    }
  } catch (err) {
    console.error(`Sweep of expired runs failed: ${err instanceof Error ? err.name : 'error'}`)
  }
  return removed
}

// ---- Leaderboard -------------------------------------------------------------------------------

interface BoardDoc {
  version: 1
  updatedAt: string | null
  ballots: number
  ties: number
  allBad: number
  ratings: Ratings
  // Run ids counted so far, kept only while their runs could still take a vote.
  recent: { runId: string; expiresAt: number }[]
}

function emptyBoard(): BoardDoc {
  return { version: 1, updatedAt: null, ballots: 0, ties: 0, allBad: 0, ratings: {}, recent: [] }
}

function parseBoard(raw: string): BoardDoc {
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.ratings) || !Array.isArray(value.recent)) {
    throw new Error('The leaderboard record is unreadable')
  }
  return value as unknown as BoardDoc
}

export function boardView(doc: BoardDoc, storage: StorageKind): LeaderboardResponse {
  return {
    rows: rankRows(doc.ratings),
    ballots: doc.ballots,
    ties: doc.ties,
    allBad: doc.allBad,
    updatedAt: doc.updatedAt,
    storage,
  }
}

export async function readBoard(store: KeyValueStore, storage: StorageKind): Promise<LeaderboardResponse> {
  const raw = await store.get(BOARD_KEY)
  return boardView(raw === undefined ? emptyBoard() : parseBoard(raw), storage)
}

export type CastResult =
  | { kind: 'counted'; changes: RatingChange[]; board: LeaderboardResponse }
  | { kind: 'duplicate' }
  | { kind: 'busy' }

export interface Ballot {
  runId: string
  entries: Entry[]
  outcome: Outcome
  tie: boolean
}

/**
 * Counts one ballot. The leaderboard is a single record that is only ever replaced through a
 * conditional write on the tag that was read, so two votes that race cannot overwrite each other:
 * the loser re-reads the winner's record and applies its own ballot on top. The record also lists
 * the run ids it has counted, which is what makes a second vote on one run a duplicate even when
 * two arrive together. 'busy' means every attempt lost the race; nothing was recorded.
 */
export async function castBallot(
  store: KeyValueStore,
  storage: StorageKind,
  ballot: Ballot,
  now: number = Date.now(),
  backoff: (attempt: number) => Promise<void> = attempt => new Promise(done => setTimeout(done, 5 + Math.random() * 25 * (attempt + 1))),
): Promise<CastResult> {
  for (let attempt = 0; attempt < BOARD_ATTEMPTS; attempt++) {
    const current = await store.getTagged(BOARD_KEY)
    const doc = current ? parseBoard(current.value) : emptyBoard()
    if (doc.recent.some(r => r.runId === ballot.runId)) return { kind: 'duplicate' }
    const { ratings, changes } = applyBallot(doc.ratings, ballot.entries, ballot.outcome)
    const next: BoardDoc = {
      version: 1,
      updatedAt: new Date(now).toISOString(),
      ballots: doc.ballots + 1,
      ties: doc.ties + (ballot.tie ? 1 : 0),
      allBad: doc.allBad + (ballot.outcome === 'all-bad' ? 1 : 0),
      ratings,
      recent: [...doc.recent.filter(r => r.expiresAt > now), { runId: ballot.runId, expiresAt: runExpiry(ballot.runId) }],
    }
    const text = JSON.stringify(next)
    const written = current ? await store.setIfMatch(BOARD_KEY, text, current.etag) : await store.setIfNew(BOARD_KEY, text)
    if (written) return { kind: 'counted', changes, board: boardView(next, storage) }
    await backoff(attempt)
  }
  return { kind: 'busy' }
}

// ---- Ballots from a stored run -----------------------------------------------------------------

export type BallotPlan =
  | { ok: true; entries: Entry[]; outcome: Outcome; tie: boolean }
  | { ok: false; error: string }

/**
 * Turns a vote on a stored run into entries and an outcome. Only answered panels take part. The vote
 * needs at least two answered panels on two different models, and a winner must be one of them.
 */
export function planBallot(run: StoredRun, choice: VoteChoice): BallotPlan {
  const shown = displayPanels(run.compare.panels, run.order)
  const answered = shown.filter(p => p.ok)
  const entries: Entry[] = answered.map(p => ({ model: p.requestedModel, served: p.servedModel }))
  if (new Set(entries.map(e => e.model)).size < 2) {
    return { ok: false, error: 'This run cannot take a vote: fewer than two different models answered.' }
  }
  if (choice === 'tie') return { ok: true, entries, outcome: 'tie', tie: true }
  if (choice === 'all-bad') return { ok: true, entries, outcome: 'all-bad', tie: false }
  const winner = answered.findIndex(p => p.slot === choice)
  if (winner < 0) return { ok: false, error: `Panel ${choice} did not give an answer, so it cannot be picked.` }
  return { ok: true, entries, outcome: { winner }, tie: false }
}

/** True when a blind compare can take a vote: two answered panels on two different models. */
export function voteable(panels: PanelResult[]): boolean {
  return new Set(panels.filter(p => p.ok).map(p => p.requestedModel)).size >= 2
}
