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

// ---- Ballots and the leaderboard ---------------------------------------------------------------

// Every ballot is its own blob, votes/<runId>, written with onlyIfNew. That one conditional write is the whole
// concurrency story: of two writers racing for one run id exactly one wins, so a run counts once, and no vote
// ever has to be merged into a shared record, so none can be lost. The leaderboard is not stored at all. It is
// folded from the ballots, in the order they were cast, whenever it is read. A read costs one list and one get
// per ballot, which suits a few thousand votes; past that, snapshot the fold.
const BALLOT_PREFIX = 'votes/'
const READ_BATCH = 25
const ballotKey = (runId: string) => `${BALLOT_PREFIX}${runId}`

export interface Ballot {
  runId: string
  entries: Entry[]
  outcome: Outcome
  tie: boolean
}

interface StoredBallot extends Ballot {
  at: number
}

function parseBallot(raw: string): StoredBallot | null {
  try {
    const v: unknown = JSON.parse(raw)
    if (isRecord(v) && typeof v.runId === 'string' && typeof v.at === 'number' && Array.isArray(v.entries) && v.outcome !== undefined) {
      return v as unknown as StoredBallot
    }
  } catch {
    // An unreadable ballot is skipped and reported by the caller's log line.
  }
  return null
}

export async function loadBallots(store: KeyValueStore): Promise<StoredBallot[]> {
  const keys = await store.list(BALLOT_PREFIX)
  const ballots: StoredBallot[] = []
  for (let i = 0; i < keys.length; i += READ_BATCH) {
    const raws = await Promise.all(keys.slice(i, i + READ_BATCH).map(key => store.get(key)))
    for (const raw of raws) {
      const ballot = raw === undefined ? null : parseBallot(raw)
      if (ballot) ballots.push(ballot)
    }
  }
  return ballots
}

interface Folded {
  doc: LeaderboardTotals
  changes: Map<string, RatingChange[]>
}

interface LeaderboardTotals {
  ballots: number
  ties: number
  allBad: number
  updatedAt: number | null
  ratings: Ratings
}

/**
 * Ballots cast before the board was keyed by served model carry the requested id (an alias such as
 * "~anthropic/claude-haiku-latest") as the key. Re-key those by the served id they recorded, unless that
 * would put two entries of one ballot on the same key.
 */
function byServedModel(entries: Entry[]): Entry[] {
  const keyed = entries.map(e => ({ ...e, model: e.served ?? e.model }))
  return new Set(keyed.map(e => e.model)).size === entries.length ? keyed : entries
}

/** Applies ballots in the order they were cast (time, then run id), remembering what each one changed. */
export function foldBallots(ballots: StoredBallot[]): Folded {
  const ordered = [...ballots].sort((a, b) => a.at - b.at || a.runId.localeCompare(b.runId))
  const doc: LeaderboardTotals = { ballots: 0, ties: 0, allBad: 0, updatedAt: null, ratings: {} }
  const changes = new Map<string, RatingChange[]>()
  for (const ballot of ordered) {
    const applied = applyBallot(doc.ratings, byServedModel(ballot.entries), ballot.outcome)
    doc.ratings = applied.ratings
    doc.ballots += 1
    doc.ties += ballot.tie ? 1 : 0
    doc.allBad += ballot.outcome === 'all-bad' ? 1 : 0
    doc.updatedAt = ballot.at
    changes.set(ballot.runId, applied.changes)
  }
  return { doc, changes }
}

export function boardView(doc: LeaderboardTotals, storage: StorageKind): LeaderboardResponse {
  return {
    rows: rankRows(doc.ratings),
    ballots: doc.ballots,
    ties: doc.ties,
    allBad: doc.allBad,
    updatedAt: doc.updatedAt === null ? null : new Date(doc.updatedAt).toISOString(),
    storage,
  }
}

export async function readBoard(store: KeyValueStore, storage: StorageKind): Promise<LeaderboardResponse> {
  return boardView(foldBallots(await loadBallots(store)).doc, storage)
}

export type CastResult =
  | { kind: 'counted'; changes: RatingChange[]; board: LeaderboardResponse }
  | { kind: 'duplicate' }

/**
 * Counts one ballot: a conditional write of its own blob, then a fold for the reply. 'duplicate' means this
 * run already has a ballot. The reply is built from what the store lists plus this ballot, so it is right
 * even when the listing has not caught up with the write.
 */
export async function castBallot(store: KeyValueStore, storage: StorageKind, ballot: Ballot, now: number = Date.now()): Promise<CastResult> {
  const stored: StoredBallot = { ...ballot, at: now }
  if (!(await store.setIfNew(ballotKey(ballot.runId), JSON.stringify(stored)))) return { kind: 'duplicate' }
  const ballots = await loadBallots(store)
  if (!ballots.some(b => b.runId === ballot.runId)) ballots.push(stored)
  const { doc, changes } = foldBallots(ballots)
  return { kind: 'counted', changes: changes.get(ballot.runId) ?? [], board: boardView(doc, storage) }
}

/**
 * The leaderboard key of an answered panel: the model id the provider answered with. The requested id is only
 * the fallback for a panel whose reply named no model.
 */
function boardKey(panel: Pick<PanelResult, 'servedModel' | 'requestedModel'>): string {
  return panel.servedModel ?? panel.requestedModel
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
  const entries: Entry[] = answered.map(p => ({ model: boardKey(p), served: p.servedModel }))
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
  return new Set(panels.filter(p => p.ok).map(boardKey)).size >= 2
}
