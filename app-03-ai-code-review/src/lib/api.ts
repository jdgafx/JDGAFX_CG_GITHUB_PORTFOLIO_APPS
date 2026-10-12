import { SEVERITIES } from '../constants'
import { batchesOf } from '../../netlify/shared/batches'
import { buildDiff, type PrFileInput } from '../../netlify/shared/diff'
import { commentBudget, type Candidate, type CheckedDrop } from '../../netlify/shared/review'
import { planShards, type Shard } from '../../netlify/shared/shards'
import { sumUsage } from '../../netlify/shared/trace'
import { buildComments, locatorFor, type Located, type Rebuttal, type Settled } from '../../netlify/shared/verify'
import type { FirstPassReply, FirstRow, Handoff, SecondRow, Ticket } from '../../netlify/shared/wire'
import type { Decider, ModelCheck, NotReviewed, ReviewRun, RunSummary, Severity, TraceStep, Verdict } from '../types'
import { DECIDERS, ReviewError, VERDICTS, isNumber, isRecord, isReviewResult, postStage } from './transport'

export { ReviewError, reviewErrorMessage } from './transport'

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string')
const isHandoff = (value: unknown): value is Handoff =>
  isRecord(value) && typeof value.id === 'string' && typeof value.text === 'string' && isRecord(value.seals) && isStrings(value.seals['read-1']) && isStrings(value.seals['read-2'])
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string'
const isNullableNumber = (value: unknown): value is number | null => value === null || isNumber(value)

function isCandidate(value: unknown): value is Candidate {
  return (
    isRecord(value) &&
    isNumber(value.id) &&
    isNumber(value.line) &&
    isNumber(value.fromLine) &&
    typeof value.quote === 'string' &&
    SEVERITIES.includes(value.severity as Severity) &&
    typeof value.message === 'string' &&
    typeof value.suggestion === 'string' &&
    isNullableString(value.moveNote) &&
    (value.loweredFrom === null || SEVERITIES.includes(value.loweredFrom as Severity))
  )
}

function isDrop(value: unknown): value is CheckedDrop {
  return isRecord(value) && isNumber(value.id) && isNumber(value.line) && isNumber(value.fromLine) && SEVERITIES.includes(value.severity as Severity) && typeof value.message === 'string' && typeof value.suggestion === 'string' && typeof value.reason === 'string'
}

/** The reply of request 1. Without a hand-off (nothing left to read) the review is already whole. */
function acceptFirst(data: Record<string, unknown>): FirstPassReply | null {
  if (!isReviewResult(data.result) || !Array.isArray(data.candidates) || !data.candidates.every(isCandidate) || !Array.isArray(data.dropped) || !data.dropped.every(isDrop)) return null
  if (data.handoff !== null && !isHandoff(data.handoff)) return null
  if (data.candidates.length > 0 && data.handoff === null) return null
  // The batches are exactly the candidates, in order, at most four to a batch: a reply that loses or repeats one is not used.
  const batches = data.batches
  if (!Array.isArray(batches) || !batches.every((b) => Array.isArray(b) && b.every(isNumber))) return null
  if (JSON.stringify(batches) !== JSON.stringify(batchesOf(data.candidates.map((c: Candidate) => c.id)))) return null
  // One seal for each read request.
  if (data.handoff !== null && (data.handoff.seals['read-1'].length !== batches.length || data.handoff.seals['read-2'].length !== batches.length)) return null
  return { result: data.result, candidates: data.candidates, dropped: data.dropped, batches: batches as number[][], handoff: data.handoff }
}

const isSettled = (value: unknown): value is FirstRow =>
  isRecord(value) &&
  isNumber(value.id) &&
  isNumber(value.line) &&
  VERDICTS.includes(value.verdict as Verdict) &&
  DECIDERS.includes(value.decidedBy as Decider) &&
  typeof value.reason === 'string' &&
  isNullableString(value.evidence) &&
  isNullableString(value.support) &&
  isNullableNumber(value.supportAt) &&
  isNullableString(value.claimKind)

const isRebuttal = (value: unknown): value is SecondRow =>
  isRecord(value) && isNumber(value.id) && (value.state === 'stands' || value.state === 'refuted' || value.state === 'unsure') && typeof value.reason === 'string' && isNullableString(value.quote)

/** What a read gave back for its batch: the rows it settled, and how many of the batch's comments it left without one. */
interface ReadRows<R> {
  rows: Map<number, R>
  missing: number
}

/**
 * A read's rows. Rows for only some of the batch's comments are kept (the others have no verdict, and come out not confirmed);
 * a row for a comment the batch does not hold, a repeated row, or a row that is not the shape promised is not a reply to use.
 */
function acceptRows<R extends { id: number }>(candidates: readonly Candidate[], check: (row: unknown) => row is R) {
  return (data: Record<string, unknown>): ReadRows<R> | null => {
    if (!Array.isArray(data.rows) || !data.rows.every(check)) return null
    const rows = new Map(data.rows.map((row: R) => [row.id, row]))
    const held = new Set(candidates.map((c) => c.id))
    if (rows.size !== data.rows.length || [...rows.keys()].some((id) => !held.has(id))) return null
    return { rows, missing: candidates.filter((c) => !rows.has(c.id)).length }
  }
}

const RANK: Record<ModelCheck, number> = { match: 0, unchecked: 1, 'not-reported': 2, mismatch: 3 }

/** What a read that did not finish leaves in the run: its failure and the stages the server reported before it. */
const summaryOfFailure = (err: unknown, fallback: number): RunSummary =>
  err instanceof ReviewError ? err.summary : { trace: [], usage: null, model: null, newestModel: null, modelCheck: 'not-reported', servedModels: [], unreportedCalls: 1, totalMs: fallback }

/** Called once pass 1 and its checks are back, with the comments that passed the checks and none confirmed yet. */
export type OnFirstPass = (run: ReviewRun) => void

/** What a shard request answers: the signed record of the comments it wrote for its range. */
function acceptShard(data: Record<string, unknown>): Ticket | null {
  const record = data.record
  return isRecord(record) && typeof record.text === 'string' && typeof record.seal === 'string' ? { text: record.text, seal: record.seal } : null
}

/** One request's summary, and where in the review's own timeline it began: its stages are placed from there. */
type Piece = RunSummary & { offset: number }

/** The trace, usage and checks of several requests as one run's: stages placed by when each request began, usage and unreported calls added. */
function combine(pieces: readonly Piece[], totalMs: number, model: string | null): RunSummary {
  return {
    trace: pieces.flatMap((p) => p.trace.map((step) => (step.at === undefined ? step : { ...step, at: step.at + p.offset }))),
    usage: sumUsage(pieces.flatMap((p) => (p.usage ? [p.usage] : []))),
    model,
    newestModel: pieces.map((p) => p.newestModel).find((m) => m !== null) ?? null,
    modelCheck: pieces.map((p) => p.modelCheck).reduce((worst, check) => (RANK[check] > RANK[worst] ? check : worst), 'match' as ModelCheck),
    servedModels: pieces.flatMap((p) => p.servedModels),
    totalMs,
    unreportedCalls: pieces.reduce((sum, p) => sum + p.unreportedCalls, 0),
  }
}

/** Where a range of numbered lines is, in words the reader can find: the lines of a file, or the files of a pull request. */
function rangeLabel(shard: Shard, locate: (line: number) => Located, inPullRequest: boolean): string {
  if (!inPullRequest) return `lines ${shard.from}-${shard.to}`
  const files: string[] = []
  for (let n = shard.from; n <= shard.to; n += 1) {
    const file = locate(n).where?.file
    if (file && !files.includes(file)) files.push(file)
  }
  return files.length === 0 ? `diff lines ${shard.from}-${shard.to}` : `${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}`
}

interface FirstPass {
  first: { value: FirstPassReply } & RunSummary
  notReviewed: NotReviewed[]
}

/**
 * Pass 1: one request for a small file or diff. For a large one, a request for each shard (a range of lines, with the whole input
 * as context) at once, then a merge that opens the shards' signed records and returns what a single request would. A shard that
 * fails fails only its own range: the review goes on without it and names it. All the shards failing is a failed review.
 */
async function firstPass(payload: object, plan: readonly Shard[], locate: (line: number) => Located, inPullRequest: boolean, signal: AbortSignal | undefined): Promise<FirstPass> {
  if (plan.length === 1) return { first: await postStage('/api/ai', payload, signal, acceptFirst), notReviewed: [] }
  const startedAt = Date.now()
  const parts = await Promise.allSettled(plan.map((_, i) => postStage(`/api/ai?shard=${i}&of=${plan.length}`, payload, signal, acceptShard)))
  if (signal?.aborted) throw signal.reason ?? new DOMException('The review was stopped.', 'AbortError')
  const shardsMs = Date.now() - startedAt
  const pieces: Piece[] = parts.map((p) => ({ ...(p.status === 'fulfilled' ? p.value : summaryOfFailure(p.reason, 0)), offset: 0 }))
  const records = parts.map((p) => (p.status === 'fulfilled' ? p.value.value : null))
  const model = pieces.find((p) => p.model !== null)?.model ?? null
  const failed = parts.map((p) => (p.status === 'rejected' ? (p.reason instanceof ReviewError ? p.reason.message : 'The request failed.') : null))
  const firstFailure = failed.find((f) => f !== null)
  if (firstFailure !== undefined && records.every((r) => r === null)) throw new ReviewError(firstFailure, combine(pieces, shardsMs, model))
  let merge: { value: FirstPassReply } & RunSummary
  try {
    merge = await postStage('/api/ai/merge', { ...payload, shards: records }, signal, acceptFirst)
  } catch (err) {
    if (err instanceof ReviewError) throw new ReviewError(err.message, combine([...pieces, { ...err.summary, offset: shardsMs }], Date.now() - startedAt, model))
    throw err
  }
  const summary = combine([...pieces, { ...merge, offset: shardsMs }], Date.now() - startedAt, model)
  const notReviewed = plan.flatMap((shard, i) => (failed[i] === null ? [] : [{ from: shard.from, to: shard.to, label: rangeLabel(shard, locate, inPullRequest), reason: failed[i] as string }]))
  return { first: { value: merge.value, ...summary }, notReviewed }
}

/**
 * One review as the browser runs it: pass 1 (one request, or a request for each shard and a merge), then the two reads of pass 2
 * (a request for each batch of at most four comments) side by side. `locate` places a numbered line. A read that fails or times out
 * does not fail the review: its comments stay on the page as not confirmed, and the result says the second pass did not finish.
 */
async function review(payload: object, plan: readonly Shard[], locate: (line: number) => Located, inPullRequest: boolean, signal: AbortSignal | undefined, onFirstPass?: OnFirstPass): Promise<ReviewRun> {
  const startedAt = Date.now()
  const { first, notReviewed } = await firstPass(payload, plan, locate, inPullRequest, signal)
  const { candidates, dropped, handoff, batches } = first.value
  const firstResult = { ...first.value.result, notReviewed }
  const afterFirst: ReviewRun = { result: firstResult, ...first, totalMs: Date.now() - startedAt }
  if (handoff === null) return afterFirst
  onFirstPass?.(afterFirst)

  const readsAt = Date.now() - startedAt
  // Each read is one request per batch of at most four comments, all at once, each with the whole input and its own ticket.
  type Batched<R> = Array<PromiseSettledResult<{ value: ReadRows<R> } & RunSummary>>
  const fanOut = <R extends { id: number }>(stage: 'read-1' | 'read-2', check: (row: unknown) => row is R): Promise<Batched<R>> =>
    Promise.allSettled(
      batches.map((ids, i) =>
        postStage(
          `/api/ai/${stage}?batch=${i}&review=${handoff.id}`,
          { ...payload, handoff: { text: handoff.text, seal: handoff.seals[stage][i] } },
          signal,
          acceptRows(candidates.filter((c) => ids.includes(c.id)), check),
        ),
      ),
    )
  const [ones, twos] = await Promise.all([fanOut('read-1', isSettled), fanOut('read-2', isRebuttal)])
  // A stopped or replaced review never reports reads: the caller drops the run on its own abort.
  if (signal?.aborted) throw signal.reason ?? new DOMException('The review was stopped.', 'AbortError')

  const combineAt = Date.now()
  // A batch that did not finish leaves its comments without a row; those come out not confirmed. A read is whole only when every batch is.
  const merged = <R,>(parts: Batched<R>): Map<number, R> => new Map(parts.flatMap((p) => (p.status === 'fulfilled' ? [...p.value.value.rows] : [])))
  const verified = [...ones, ...twos].every((p) => p.status === 'fulfilled' && p.value.value.missing === 0)
  const firsts = merged(ones) as Map<number, Settled>
  const seconds = merged(twos) as Map<number, Rebuttal>
  const comments = buildComments(candidates, dropped, firsts, seconds, locate, inPullRequest)
  const count = (v: Verdict) => comments.filter((c) => c.verdict === v).length

  const reads: Piece[] = [...ones, ...twos].map((r) => ({ ...(r.status === 'fulfilled' ? r.value : summaryOfFailure(r.reason, 0)), offset: readsAt }))
  const readsEnd = Math.max(0, ...reads.flatMap((r) => r.trace.map((s) => (s.at ?? 0) + s.ms))) 
  const validated: TraceStep = {
    name: 'Re-validate',
    status: 'ok',
    ms: Date.now() - combineAt,
    at: readsAt + readsEnd,
    detail: verified
      ? `Every verdict checked against the code: ${count('kept')} kept, ${count('moved')} moved, ${count('dropped')} dropped, ${count('unverified')} not confirmed`
      : `A second-pass read did not finish: ${count('unverified')} ${count('unverified') === 1 ? 'comment' : 'comments'} not confirmed, ${count('dropped')} dropped`,
  }
  const summary = combine([{ ...first, offset: 0 }, ...reads], Date.now() - startedAt, first.model)
  return { result: { ...firstResult, comments, verified }, ...summary, trace: [...summary.trace, validated] }
}

/** Posts code for review. `onFirstPass` gets the first pass's comments as soon as they are back. */
export function reviewCode(code: string, language: string, signal?: AbortSignal, onFirstPass?: OnFirstPass): Promise<ReviewRun> {
  const lines = code.split('\n')
  return review({ code, language }, planShards(lines, null, commentBudget(lines.length)), locatorFor(lines, null), false, signal, onFirstPass)
}

/** Posts the chosen files of a pull request for review. Each patch is exactly what GitHub listed. */
export function reviewPullRequest(files: PrFileInput[], signal?: AbortSignal, onFirstPass?: OnFirstPass): Promise<ReviewRun> {
  const built = buildDiff(files)
  const texts = built.units.map((u) => u.shown)
  return review({ mode: 'pr', files }, planShards(texts, built.units, commentBudget(built.changed)), locatorFor(texts, built.units), true, signal, onFirstPass)
}
