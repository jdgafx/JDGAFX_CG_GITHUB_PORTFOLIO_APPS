import { SEVERITIES } from '../constants'
import { buildDiff, type PrFileInput } from '../../netlify/shared/diff'
import type { Candidate, CheckedDrop } from '../../netlify/shared/review'
import { batchesOf } from '../../netlify/shared/batches'
import { sumUsage } from '../../netlify/shared/trace'
import { buildComments, locatorFor, type Located, type Rebuttal, type Settled } from '../../netlify/shared/verify'
import type { FirstPassReply, FirstRow, Handoff, SecondRow } from '../../netlify/shared/wire'
import type { Decider, ModelCheck, PrCounts, ReviewComment, ReviewResult, ReviewRun, RunSummary, ServedCall, Severity, StepStatus, TraceStep, Usage, Verdict } from '../types'

/** One request's limit. The platform cuts a function at 26 s (netlify/shared/budget.ts), so a request still open at 30 s is lost. */
const REQUEST_TIMEOUT_MS = 30_000
const STEP_STATUSES: StepStatus[] = ['ok', 'failed', 'skipped']
const VERDICTS: Verdict[] = ['kept', 'moved', 'dropped', 'unverified']
const DECIDERS: Decider[] = ['verifier', 'check', 'none']
const MODEL_CHECKS: ModelCheck[] = ['match', 'mismatch', 'unchecked', 'not-reported']
/** A connection that drops sooner than this is retried once; later than this the run budget is spent. */
const RETRY_WITHIN_MS = 12_000

const GENERIC_ERROR = 'The review service is unavailable right now. Please try again.'
const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.'
const TIMEOUT_ERROR = 'The AI provider did not answer in time.'
const CUT_OFF_ERROR = 'The connection dropped before the review finished. Please try again.'
const RATE_LIMITED = 'Rate limited, try again in a minute.'

/** A failed review. `message` is safe to show; `summary` holds whatever trace the run produced. */
export class ReviewError extends Error {
  readonly summary: RunSummary

  constructor(message: string, summary: RunSummary) {
    super(message)
    this.name = 'ReviewError'
    this.summary = summary
  }
}

/** The text to show for a failed review. Only a ReviewError carries a message written for people; anything else gets the generic copy. */
export function reviewErrorMessage(err: unknown): string {
  return err instanceof ReviewError ? err.message : GENERIC_ERROR
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function isWhere(value: unknown): boolean {
  return value === null || (isRecord(value) && typeof value.file === 'string' && isNumber(value.line) && (value.side === 'new' || value.side === 'old'))
}

function isComment(value: unknown): value is ReviewComment {
  return (
    isRecord(value) &&
    isNumber(value.id) &&
    isNumber(value.line) &&
    isNumber(value.fromLine) &&
    SEVERITIES.includes(value.severity as Severity) &&
    typeof value.message === 'string' &&
    typeof value.suggestion === 'string' &&
    VERDICTS.includes(value.verdict as Verdict) &&
    DECIDERS.includes(value.decidedBy as Decider) &&
    typeof value.reason === 'string' &&
    (value.evidence === null || typeof value.evidence === 'string') &&
    (value.support === null || typeof value.support === 'string') &&
    (value.supportLine === null || isNumber(value.supportLine)) &&
    (value.claimKind === undefined || value.claimKind === null || typeof value.claimKind === 'string') &&
    typeof value.code === 'string' &&
    isWhere(value.where)
  )
}

function isStep(value: unknown): value is TraceStep {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    STEP_STATUSES.includes(value.status as StepStatus) &&
    isNumber(value.ms) &&
    typeof value.detail === 'string' &&
    (value.at === undefined || isNumber(value.at))
  )
}

function isServedCall(value: unknown): value is ServedCall {
  return isRecord(value) && typeof value.pass === 'string' && (value.model === null || typeof value.model === 'string')
}

function isCounts(value: unknown): value is PrCounts {
  return isRecord(value) && isNumber(value.filesIncluded) && isNumber(value.changedIncluded) && isNumber(value.charsIncluded) && isNumber(value.charLimit)
}

/** The one check on a successful reply. The server already validated every comment; this keeps a malformed reply from reaching the UI. */
function isReviewResult(value: unknown): value is ReviewResult {
  return (
    isRecord(value) &&
    isNumber(value.lineCount) &&
    typeof value.truncated === 'boolean' &&
    typeof value.verified === 'boolean' &&
    isNumber(value.malformed) &&
    (value.mode === 'file' || value.mode === 'pr') &&
    (value.pr === null || isCounts(value.pr)) &&
    Array.isArray(value.comments) &&
    value.comments.every(isComment)
  )
}

/** The trace, usage and timing of a run, or empty values where the reply carried none that could be read. */
function summaryOf(data: unknown): RunSummary {
  const reply = isRecord(data) ? data : {}
  return {
    trace: Array.isArray(reply.trace) && reply.trace.every(isStep) ? reply.trace : [],
    usage: isRecord(reply.usage) && Object.values(reply.usage).every(isNumber) ? (reply.usage as Usage) : null,
    model: typeof reply.model === 'string' ? reply.model : null,
    newestModel: typeof reply.newestModel === 'string' ? reply.newestModel : null,
    modelCheck: MODEL_CHECKS.includes(reply.modelCheck as ModelCheck) ? (reply.modelCheck as ModelCheck) : 'not-reported',
    servedModels: Array.isArray(reply.servedModels) && reply.servedModels.every(isServedCall) ? reply.servedModels : [],
    totalMs: isNumber(reply.totalMs) ? reply.totalMs : 0,
    // The server counts the calls it could not account for. An answer that is not the server's JSON (a platform cut-off page)
    // leaves the call that was running unknown.
    unreportedCalls: isNumber(reply.unreportedCalls) ? reply.unreportedCalls : isRecord(data) ? 0 : 1,
  }
}

/** The server's plain-language error when it sent one, otherwise a message chosen by status. */
function serverMessage(status: number, error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error
  if (status === 429) return RATE_LIMITED
  if (status === 504) return TIMEOUT_ERROR
  return GENERIC_ERROR
}

const attemptStep = (detail: string, startedAt: number, status: StepStatus = 'failed'): TraceStep => ({
  name: 'Send request',
  status,
  ms: Date.now() - startedAt,
  at: 0,
  detail,
})

/**
 * Posts one request of a review. `accept` reads the successful reply and returns null for one that is not the shape that
 * request promises. Rejects with a ReviewError whose message is safe to show. Aborts on `signal` (user cancel) with the abort
 * error; the caller ignores that one. A connection that drops early, or a reply that ends before its JSON does, gets one
 * automatic retry; a rejection, a rate limit, a server error or a timeout never does.
 */
async function postStage<T>(path: string, payload: unknown, signal: AbortSignal | undefined, accept: (data: Record<string, unknown>) => T | null): Promise<{ value: T } & RunSummary> {
  const startedAt = Date.now()
  let dropped: TraceStep | null = null

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS)
    const onAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    const attemptAt = Date.now()
    const retryable = () => attempt === 1 && Date.now() - startedAt <= RETRY_WITHIN_MS

    try {
      let response: Response
      let data: unknown
      try {
        response = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        data = await response.json().catch(() => null)
      } catch (err) {
        if (signal?.aborted) throw err
        const totalMs = Date.now() - startedAt
        if ((err as Error)?.name === 'TimeoutError') {
          throw new ReviewError(TIMEOUT_ERROR, withDropped({ trace: [attemptStep('No answer from the server in time', attemptAt)], usage: null, model: null, newestModel: null, modelCheck: 'not-reported', servedModels: [], unreportedCalls: 1, totalMs }, dropped))
        }
        if (retryable()) {
          dropped = attemptStep('Could not reach the server. Retried once', attemptAt)
          continue
        }
        // Logged only when the last try fails: a dropped connection that the retry recovers is not an error.
        console.error('CodeLens: review request failed', err)
        throw new ReviewError(NETWORK_ERROR, withDropped({ trace: [attemptStep('Could not reach the server', attemptAt)], usage: null, model: null, newestModel: null, modelCheck: 'not-reported', servedModels: [], unreportedCalls: 1, totalMs }, dropped))
      }

      // A reply that started and then ended before its JSON did: the connection dropped mid-answer.
      if (data === null && response.ok) {
        if (retryable()) {
          dropped = attemptStep(`The connection dropped before the reply finished (HTTP ${response.status}). Retried once`, attemptAt)
          continue
        }
        throw new ReviewError(CUT_OFF_ERROR, withDropped({ trace: [attemptStep('The reply ended before it finished', attemptAt)], usage: null, model: null, newestModel: null, modelCheck: 'not-reported', servedModels: [], unreportedCalls: 1, totalMs: Date.now() - startedAt }, dropped))
      }
      if (!response.ok || !isRecord(data) || data.success !== true) {
        const summary = summaryOf(data)
        if (summary.trace.length === 0) summary.trace = [attemptStep(`The server answered HTTP ${response.status} without a trace`, attemptAt)]
        throw new ReviewError(serverMessage(response.status, isRecord(data) ? data.error : undefined), withDropped(summary, dropped))
      }
      const value = accept(data)
      if (value === null) throw new ReviewError(GENERIC_ERROR, withDropped(summaryOf(data), dropped))
      return { value, ...withDropped(summaryOf(data), dropped) }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
  throw new ReviewError(NETWORK_ERROR, { trace: [], usage: null, model: null, newestModel: null, modelCheck: 'not-reported', servedModels: [], unreportedCalls: 1, totalMs: Date.now() - startedAt })
}

/** Puts the dropped first attempt in front of the server's trace, so a retry is never invisible. */
function withDropped(summary: RunSummary, dropped: TraceStep | null): RunSummary {
  // A connection that was lost may have reached the server and run a call: it is one the totals cannot account for.
  return dropped ? { ...summary, trace: [dropped, ...summary.trace], unreportedCalls: summary.unreportedCalls + 1 } : summary
}

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

/**
 * One review as the browser runs it: request 1 (pass 1 and the checks), then requests 2 and 3 (the two reads of pass 2) side by
 * side. `locate` places a numbered line. A read that fails or times out does not fail the review: its comments stay on the page
 * as not confirmed, and the result says the second pass did not finish.
 */
async function review(payload: object, locate: (line: number) => Located, inPullRequest: boolean, signal: AbortSignal | undefined, onFirstPass?: OnFirstPass): Promise<ReviewRun> {
  const startedAt = Date.now()
  const first = await postStage('/api/ai', payload, signal, acceptFirst)
  const { candidates, dropped, handoff, batches } = first.value
  const afterFirst: ReviewRun = { result: first.value.result, ...first, totalMs: Date.now() - startedAt }
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

  const reads = [...ones, ...twos].map((r) => (r.status === 'fulfilled' ? r.value : summaryOfFailure(r.reason, 0)))
  // The reads ran side by side: place each one's stages from where the browser started them, and list read 1 first.
  const readTrace = reads.flatMap((r) => r.trace.map((step) => ({ ...step, at: (step.at ?? 0) + readsAt })))
  const readsEnd = Math.max(0, ...readTrace.map((s) => (s.at ?? 0) + s.ms)) - readsAt
  const validated: TraceStep = {
    name: 'Re-validate',
    status: 'ok',
    ms: Date.now() - combineAt,
    at: readsAt + readsEnd,
    detail: verified
      ? `Every verdict checked against the code: ${count('kept')} kept, ${count('moved')} moved, ${count('dropped')} dropped, ${count('unverified')} not confirmed`
      : `A second-pass read did not finish: ${count('unverified')} ${count('unverified') === 1 ? 'comment' : 'comments'} not confirmed, ${count('dropped')} dropped`,
  }
  const all = [first, ...reads]
  const served = all.flatMap((r) => r.servedModels)
  return {
    result: { ...first.value.result, comments, verified },
    trace: [...first.trace, ...readTrace, validated],
    usage: sumUsage(all.flatMap((r) => (r.usage ? [r.usage] : []))),
    model: first.model,
    newestModel: first.newestModel ?? all.map((r) => r.newestModel).find((m) => m !== null) ?? null,
    modelCheck: all.map((r) => r.modelCheck).reduce((worst, check) => (RANK[check] > RANK[worst] ? check : worst)),
    servedModels: served,
    totalMs: Date.now() - startedAt,
    unreportedCalls: all.reduce((sum, r) => sum + r.unreportedCalls, 0),
  }
}

/** Posts code for review. `onFirstPass` gets the first pass's comments as soon as they are back. */
export function reviewCode(code: string, language: string, signal?: AbortSignal, onFirstPass?: OnFirstPass): Promise<ReviewRun> {
  return review({ code, language }, locatorFor(code.split('\n'), null), false, signal, onFirstPass)
}

/** Posts the chosen files of a pull request for review. Each patch is exactly what GitHub listed. */
export function reviewPullRequest(files: PrFileInput[], signal?: AbortSignal, onFirstPass?: OnFirstPass): Promise<ReviewRun> {
  const units = buildDiff(files).units
  return review({ mode: 'pr', files }, locatorFor(units.map((u) => u.shown), units), true, signal, onFirstPass)
}
