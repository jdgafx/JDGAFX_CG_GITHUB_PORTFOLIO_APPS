import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import type { Chunk, ChunkKeyPoints, Finding, Frame, Merged, Outcome, RetryOutcome, ReviewState, Summary, TraceRow } from '../../src/types/frames'
import { pause, type Limiter, type RunBudget } from './budget'
import { CHUNK_TARGET, splitText } from './chunk'
import { attribute } from './attribute'
import { callFields, CUT_OFF_MESSAGE, isCutOff, traceRow } from './rows'
import { writeSummary } from './writer'
import { addCentralPoints, citedChunks, citedPointIds, computeCoverage, pointIdsOf } from './coverage'
import { ProviderError, RunFailure, plainMessage } from './errors'
import type { GraphStateType } from './graph-state'
import { mergeFindings } from './merge'
import {
  ATTRIBUTE,
  ATTRIBUTE_CALL_TIMEOUT_MS,
  CHECK,
  CHECK_BUDGET_MARGIN_MS,
  CHECK_CALL_TIMEOUT_MS,
  EXTRACT_CALL_TIMEOUT_MS,
  EXTRACT,
  MAX_RETRIES,
  MIN_CHECK_BUDGET_MS,
  MIN_EXTRACT_RETRY_BUDGET_MS,
  MIN_RESYNTH_BUDGET_MS,
  MIN_RETRY_BUDGET_MS,
  RETRY_CALL_TIMEOUT_MS,
  RETRY_PAUSE_MS,
  SYNTH_CALL_TIMEOUT_MS,
} from './models'
import type { ChatFn, ChatReply } from './openrouter'
import { parseExtraction, parseImportant } from './parse'
import type { ModelList } from './prices'
import { checkMessages, extractMessages, synthesizeMessages } from './prompts'

export interface NodeDeps {
  chat: ChatFn
  limiter: Limiter
  budget: RunBudget
  /** OpenRouter's model list (prices and the newest model), or null when it could not be read. Started with the run, so it is usually settled before the first reply. */
  models: Promise<ModelList | null>
  /** Pause before each retry call. Defaults to RETRY_PAUSE_MS. */
  retryPauseMs?: number
  /** Timeout for the first-pass extract calls. Defaults to EXTRACT_CALL_TIMEOUT_MS. */
  extractCallTimeoutMs?: number
  /** Timeout for the retry pass's extract calls. Defaults to RETRY_CALL_TIMEOUT_MS. */
  retryCallTimeoutMs?: number
  /** Timeout for the advisory review call. Defaults to CHECK_CALL_TIMEOUT_MS, and is cut to fit what is left of the run budget. */
  checkCallTimeoutMs?: number
  /** Timeout for each attribution call. Defaults to ATTRIBUTE_CALL_TIMEOUT_MS, and is cut to fit what is left of the run budget. */
  attributeCallTimeoutMs?: number
  /** Timeout for the synthesis call. Defaults to SYNTH_CALL_TIMEOUT_MS. */
  synthCallTimeoutMs?: number
  /** Request 1 only: reduce sends the chunks that gave no key points back through extract once, if the retry fits the budget. */
  retryEmpty?: boolean
}

/** What a Send hands to extract: one chunk, the chunk count, and the pass (1 first, 2 for the retry). */
export interface ExtractInput {
  chunk: Chunk
  total: number
  pass: 1 | 2
}

type Emit = (frame: Frame) => void

/** How one extract call ended: an update for the graph, or an error with its already-written failed row. */
type Attempt = { update: Partial<GraphStateType> } | { error: unknown; row: TraceRow }
type Update = Partial<GraphStateType>

/** Shown in place of another call's message when a sibling's fatal error stopped this call. */
const STOPPED_MESSAGE = 'Stopped because another call in this run failed.'

/** The notice on a summary whose coverage retry was left out because little of the run budget remained. */
export const RETRY_SKIPPED_NOTICE = 'The coverage retry was skipped to stay inside the time limit.'

const chunkWord = (n: number): string => (n === 1 ? 'chunk' : 'chunks')
const chunkCount = (n: number): string => `${n} ${chunkWord(n)}`

function emitterFor(config: LangGraphRunnableConfig | undefined): Emit {
  const writer = config?.writer
  return (frame) => {
    if (writer) writer(frame)
  }
}

function keyPointsOf(merged: Merged): ChunkKeyPoints[] {
  return merged.byChunk.map((c) => ({ chunk: c.chunkId, points: c.points }))
}

export function noPointsMessage(trace: TraceRow[]): string {
  const failed = trace.find((r) => r.node === 'extract' && r.status === 'failed' && r.message)
  return failed?.message ?? 'No chunk produced key points, so there is nothing to summarize.'
}

/**
 * The message for a failed extract row. A call stopped by a sibling's fatal error says so, and the
 * failing call keeps its own message.
 */
function extractFailureText(err: unknown, budget: RunBudget): string {
  const cause = budget.haltCause()
  if (cause !== null && err !== cause) return STOPPED_MESSAGE
  return plainMessage(err, budget.expired())
}

/**
 * The node functions for one run. Each closes over that run's chat function, limiter and budget,
 * so nothing is shared between requests.
 */
export function makeNodes(deps: NodeDeps) {
  const { chat, limiter, budget, models } = deps
  const retryPause = deps.retryPauseMs ?? RETRY_PAUSE_MS
  const extractCallTimeout = deps.extractCallTimeoutMs ?? EXTRACT_CALL_TIMEOUT_MS
  const retryCallTimeout = deps.retryCallTimeoutMs ?? RETRY_CALL_TIMEOUT_MS
  const checkCallTimeout = deps.checkCallTimeoutMs ?? CHECK_CALL_TIMEOUT_MS
  const synthCallTimeout = deps.synthCallTimeoutMs ?? SYNTH_CALL_TIMEOUT_MS
  const attributeCallTimeout = deps.attributeCallTimeoutMs ?? ATTRIBUTE_CALL_TIMEOUT_MS

  const split = async (state: GraphStateType, config?: LangGraphRunnableConfig): Promise<Update> => {
    const emit = emitterFor(config)
    emit({ type: 'node_start', node: 'split', ms: budget.elapsed(), detail: 'Splitting the text into chunks' })
    const startedAt = Date.now()
    const chunks = splitText(state.text)
    if (chunks.length === 0) throw new RunFailure('There is no text to analyze.')
    const done = traceRow(
      'split',
      'ok',
      Date.now() - startedAt,
      `${chunkCount(chunks.length)} of about ${CHUNK_TARGET.toLocaleString('en-US')} characters`,
    )
    emit({ type: 'node_end', ...done })
    emit({ type: 'edge', from: 'split', to: 'extract', label: `fan out: ${chunkCount(chunks.length)}`, count: chunks.length })
    return { chunks, trace: [done] }
  }

  /**
   * One chunk. It is announced as started when the limiter hands it a slot, and its row is written before
   * the slot is given up, so a waiting chunk is never shown as running and no more chunks than the limiter
   * allows are open at once. A rate limit, a timeout, a server error or a refused request costs this
   * chunk only, and the coverage check may retry it once after a pause. A rejected key halts every
   * parallel call.
   */
  const extract = async (input: ExtractInput, config?: LangGraphRunnableConfig): Promise<Update> => {
    const emit = emitterFor(config)
    const { chunk, total, pass } = input
    const label = pass === 2 ? `chunk ${chunk.id} of ${total} (retry)` : `chunk ${chunk.id} of ${total}`

    // `made` is false when the pause or the queue ended before the call began: no call, nothing billed, nothing to report.
    // A call that was made and got no reply names its model and carries no usage, which the totals count as not reported.
    const fail = (err: unknown, spent: number, made = true): Attempt => {
      const row = traceRow('extract', 'failed', spent, label, {
        chunk: chunk.id,
        ...(made ? { model: EXTRACT.model } : {}),
        message: extractFailureText(err, budget),
      })
      emit({ type: 'node_end', ...row })
      return { error: err, row }
    }

    const finish = async (reply: ChatReply, callMs: number): Promise<Attempt> => {
      const fields = await callFields(EXTRACT.model, reply, models)
      const parsed = isCutOff(reply) ? null : parseExtraction(reply.text)
      if (!parsed || parsed.points.length === 0) {
        const row = traceRow('extract', 'failed', callMs, label, {
          chunk: chunk.id,
          message: isCutOff(reply) ? CUT_OFF_MESSAGE : 'The model reply had no key points.',
          ...fields,
        })
        emit({ type: 'node_end', ...row })
        return { update: { trace: [row] } }
      }
      const finding: Finding = {
        chunkId: chunk.id,
        points: parsed.points,
        entities: parsed.entities,
        model: reply.servedModel,
        usage: reply.usage,
      }
      const row = traceRow('extract', 'ok', callMs, label, { chunk: chunk.id, ...fields })
      emit({ type: 'node_end', ...row })
      return { update: { findings: [finding], trace: [row] } }
    }

    let attempt: Attempt
    try {
      if (pass === 2) await pause(retryPause, budget.signal)
      attempt = await limiter.run(async () => {
        const began = Date.now()
        emit({ type: 'node_start', node: 'extract', ms: budget.elapsed(), detail: label, chunk: chunk.id })
        try {
          const request = { ...EXTRACT, messages: extractMessages(chunk, total), timeoutMs: pass === 2 ? retryCallTimeout : extractCallTimeout }
          return await finish(await chat(request, budget.signal), Date.now() - began)
        } catch (err) {
          if (err instanceof ProviderError && err.fatal) budget.halt(err)
          return fail(err, Date.now() - began)
        }
      }, budget.signal)
    } catch (err) {
      // The pause or the queue ended before this chunk's call began.
      attempt = fail(err, 0, false)
    }

    if ('update' in attempt) return attempt.update
    const err = attempt.error
    const chunkLevel = err instanceof ProviderError && !err.fatal && !budget.expired() && !budget.halted()
    if (chunkLevel) return { trace: [attempt.row] }
    throw err
  }

  const reduce = async (state: GraphStateType, config?: LangGraphRunnableConfig): Promise<Update> => {
    const emit = emitterFor(config)
    emit({ type: 'node_start', node: 'reduce', ms: budget.elapsed(), detail: 'Merging findings' })
    const startedAt = Date.now()
    const merged = mergeFindings(state.findings)
    const done = traceRow(
      'reduce',
      'ok',
      Date.now() - startedAt,
      `Merged ${merged.findingCount} ${merged.findingCount === 1 ? 'finding' : 'findings'} into ${chunkCount(merged.byChunk.length)}, ${merged.entities.length} unique ${merged.entities.length === 1 ? 'entity' : 'entities'}`,
    )
    emit({ type: 'node_end', ...done })
    const update: Update = { merged, trace: [done] }

    // Request 1 has no check step to ask for a retry, so reduce does: the chunks that gave no key points go back once.
    if (deps.retryEmpty) {
      const empty = state.chunks.filter((c) => !merged.byChunk.some((m) => m.chunkId === c.id))
      const retry = state.retries === 0 && empty.length > 0 && budget.remaining() >= MIN_EXTRACT_RETRY_BUDGET_MS
      update.decision = retry ? 'retry' : 'final'
      if (retry) {
        update.retries = 1
        emit({ type: 'edge', from: 'reduce', to: 'extract', label: `retry ${chunkCount(empty.length)} that gave no key points` })
      }
      return update
    }

    // After a retry, a second synthesis and check run only if they can add something and still fit.
    if (state.retries > 0) {
      const withPoints = new Set(merged.byChunk.map((c) => c.chunkId))
      const gained = merged.findingCount > (state.draft?.findingCount ?? 0)
      const uncited = state.coverage.missing.some((id) => withPoints.has(id))
      const noTime = budget.remaining() < MIN_RESYNTH_BUDGET_MS
      if (noTime || (!gained && !uncited)) {
        const missing = chunkCount(state.coverage.missing.length)
        const label = noTime ? `${missing} still missing, retry skipped for time` : `${missing} still missing after the retry`
        emit({ type: 'edge', from: 'check', to: 'final', label })
        update.decision = 'final'
        update.retryOutcome = noTime ? 'skipped' : 'used-nothing-new'
        update.notice = noTime ? RETRY_SKIPPED_NOTICE : `${missing} still missing after the retry. The summary is from the first pass.`
      }
    }
    return update
  }

  const synthesize = async (state: GraphStateType, config?: LangGraphRunnableConfig): Promise<Update> => {
    const emit = emitterFor(config)
    emit({ type: 'node_start', node: 'synthesize', ms: budget.elapsed(), detail: 'Writing the cited summary' })
    const merged = state.merged
    if (!merged || merged.byChunk.length === 0) throw new RunFailure(noPointsMessage(state.trace))
    const chunkIds = state.chunks.map((c) => c.id)
    const withPoints = new Set(merged.byChunk.map((c) => c.chunkId))
    const missed = state.coverage.missing.filter((id) => withPoints.has(id))

    const { summary, ms, fields } = await writeSummary(
      { chat, budget, models, timeoutMs: synthCallTimeout, emit },
      synthesizeMessages(merged, chunkIds, missed),
      chunkIds,
      'Writing the cited summary',
    )
    const points = summary.sections.reduce((n, s) => n + s.points.length, 0)
    const note = missed.length > 0 ? `, retry asks for chunk ${missed.join(', ')}` : ''
    const done = traceRow('synthesize', 'ok', ms, `${summary.sections.length} sections, ${points} points${note}`, fields)
    emit({ type: 'node_end', ...done })
    return { summary, trace: [done] }
  }

  /**
   * Coverage, in three steps. First one attribution call per chunk, together, judges which key points the finished
   * sentences state (attribute.ts); a key point is used only when a sentence states it, and the writer's own chunk
   * citations decide nothing about points. Then coverage is computed from those ids: a chunk is covered when it has
   * points and the writer cites it, as before. Then one review call gets only the unused points and says which are central
   * to the document's main subject, and each of those is added to the summary as a sentence of its own (the point's extracted
   * text, no model call), so a central fact the writer dropped is stated. The review never starts a retry.
   * It is not called when every point is used, and it is skipped, never started, when too little of the run budget is left,
   * because a budget that expires inside the call would discard a finished summary. The retry counter moves here, so the
   * router only reads the decision this node writes. Every pass also leaves its outcome as the draft, which a failed
   * retry returns.
   */
  const check = async (state: GraphStateType, config?: LangGraphRunnableConfig): Promise<Update> => {
    const emit = emitterFor(config)
    emit({ type: 'node_start', node: 'check', ms: budget.elapsed(), detail: 'Checking coverage' })
    const merged = state.merged
    const summary = state.summary
    if (!merged || !summary) throw new RunFailure('There is no summary to check.')
    const chunkIds = state.chunks.map((c) => c.id)
    const withPoints = new Set(merged.byChunk.map((c) => c.chunkId))
    const pointIds = pointIdsOf(merged)

    const checkFields = async (reply: ChatReply): Promise<Partial<TraceRow>> => callFields(ATTRIBUTE.model, reply, models)
    const attribution = await attribute({ chat, limiter, budget, timeoutMs: attributeCallTimeout, fields: checkFields, emit }, summary, merged)
    // The sentences keep the ids the check found for them, so the page can show which key points a sentence states.
    let index = 0
    const checked: Summary = {
      ...summary,
      sections: summary.sections.map((section) => ({
        ...section,
        points: section.points.map((point) => ({ ...point, points: attribution.stated.get((index += 1)) ?? [] })),
      })),
    }
    const citedPoints = citedPointIds(checked, pointIds)
    const unused = merged.byChunk.flatMap((c) => c.points).filter((p) => !citedPoints.has(p.id))

    let flagged: string[] = []
    let review: ReviewState
    let done: TraceRow
    const startedAt = Date.now()
    if (unused.length === 0) {
      review = 'not-needed'
      done = traceRow('check', 'ok', 0, 'The summary uses every key point, so there was nothing to review')
    } else if (budget.remaining() < MIN_CHECK_BUDGET_MS) {
      review = 'skipped'
      done = traceRow('check', 'failed', 0, `Review skipped: too little of the time limit was left. ${unused.length} key points are not used.`)
    } else {
      // The call ends before the budget does, so the budget cannot expire inside it.
      const timeoutMs = Math.min(checkCallTimeout, budget.remaining() - CHECK_BUDGET_MARGIN_MS)
      try {
        const reply = await chat({ ...CHECK, timeoutMs, messages: checkMessages(summary, unused) }, budget.signal)
        const ms = Date.now() - startedAt
        const fields = await callFields(CHECK.model, reply, models)
        const important = isCutOff(reply)
          ? null
          : parseImportant(reply.text, unused.map((p) => p.id))
        if (important === null) {
          review = 'unavailable'
          done = traceRow('check', 'failed', ms, `Review reply was ${isCutOff(reply) ? 'cut off' : 'not readable'}. The unused key points are listed without it.`, fields)
        } else {
          review = 'done'
          flagged = important
          done = traceRow('check', 'ok', ms, `Reviewed ${unused.length} unused key points: ${important.length} central to the main subject${important.length > 0 ? ', added to the summary' : ''}`, fields)
        }
      } catch (err) {
        // The review is a second opinion. A failure here never discards a finished summary. Its call was made and no reply
        // came, so the row names the model and carries no usage, which the totals count as not reported.
        const message = plainMessage(err, budget.expired())
        const lost = traceRow('check', 'failed', Date.now() - startedAt, `Review unavailable: ${message} The unused key points are listed without it.`, { model: CHECK.model, message })
        if (!(err instanceof ProviderError) || budget.expired()) {
          emit({ type: 'node_end', ...lost })
          throw err
        }
        review = 'unavailable'
        done = lost
      }
    }

    // The central points are added before coverage is computed, so the key point counts and the kept draft are of the summary the page shows.
    // The chunk view stays the writer's: a chunk is covered when the writer cites it, so a restated point does not stop a chunk retry.
    const secondFlags = [...new Set(flagged)]
    const stated = addCentralPoints(checked, merged, secondFlags)
    const secondCoverage = computeCoverage({ chunkIds, withPoints, cited: citedChunks(checked, chunkIds), pointIds, citedPoints: citedPointIds(stated, pointIds), unchecked: attribution.unchecked })

    // After a retry the second summary replaces the first only if it covers more chunks. Never return less than
    // the run already had: on a tie or a loss the first-pass summary, coverage and flags are kept.
    const first = state.retries > 0 ? state.draft : null
    const keepFirst = first !== null && secondCoverage.covered.length <= first.coverage.covered.length
    const coverage = keepFirst ? first.coverage : secondCoverage
    const reviewFlags = keepFirst ? first.reviewFlags : secondFlags
    const reviewState = keepFirst ? first.review : review
    const keptSummary = keepFirst ? first.summary : stated
    let keptNotice: string | null = null
    if (keepFirst) {
      const total = chunkIds.length
      const before = `${first.coverage.covered.length} of ${total}`
      const after = `${secondCoverage.covered.length} of ${total}`
      keptNotice = `The retry pass covered ${after} chunks against ${before} in the first pass, so the first-pass summary is kept.`
      // The retry pass's review flags went with its summary, so the row does not report them.
      done = {
        ...done,
        detail: `Kept the first-pass summary: it covers ${before} chunks, the retry pass ${after}. The retry pass's review flags were discarded with it.`,
      }
    }

    const wantsRetry = coverage.missing.length > 0 && state.retries < MAX_RETRIES
    const skipRetry = wantsRetry && budget.remaining() < MIN_RETRY_BUDGET_MS
    const willRetry = wantsRetry && !skipRetry
    const notice = skipRetry ? RETRY_SKIPPED_NOTICE : keptNotice
    const retryOutcome: RetryOutcome = skipRetry ? 'skipped' : keepFirst ? 'kept-first' : state.retries > 0 ? 'used' : 'none'
    emit({ type: 'node_end', ...done })
    if (willRetry) {
      emit({ type: 'edge', from: 'check', to: 'extract', label: `retry ${coverage.missing.length} missing ${chunkWord(coverage.missing.length)}` })
    } else {
      emit({
        type: 'edge',
        from: 'check',
        to: 'final',
        label:
          coverage.missing.length === 0
            ? 'coverage complete'
            : skipRetry
              ? `${chunkCount(coverage.missing.length)} still missing, retry skipped for time`
              : `${chunkCount(coverage.missing.length)} still missing after the retry`,
      })
    }
    const draft: Outcome = {
      summary: keptSummary,
      coverage,
      entities: merged.entities,
      retries: state.retries,
      chunkCount: chunkIds.length,
      findingCount: merged.findingCount,
      keyPoints: keyPointsOf(merged),
      reviewFlags,
      review: reviewState,
      notice,
      retryOutcome,
    }
    return {
      summary: keptSummary,
      coverage,
      reviewFlags,
      review: reviewState,
      notice,
      retryOutcome,
      decision: willRetry ? 'retry' : 'final',
      retries: willRetry ? state.retries + 1 : state.retries,
      draft,
      trace: [...attribution.rows, done],
    }
  }

  const final = async (state: GraphStateType, config?: LangGraphRunnableConfig): Promise<Update> => {
    const emit = emitterFor(config)
    emit({ type: 'node_start', node: 'final', ms: budget.elapsed(), detail: 'Finishing the run' })
    const startedAt = Date.now()
    const merged = state.merged
    if (!merged || !state.summary) throw new RunFailure('There is no summary to return.')
    const total = state.chunks.length
    const missing = state.coverage.missing
    const { citedPoints, uncitedPoints } = state.coverage
    const points = `${citedPoints.length} of ${citedPoints.length + uncitedPoints.length} key points used`
    const detail =
      missing.length === 0
        ? `${points}. ${total} of ${chunkCount(total)} cited`
        : `${points}. ${state.coverage.covered.length} of ${chunkCount(total)} cited. Still missing: chunk ${missing.join(', ')}`
    const outcome: Outcome = {
      summary: state.summary,
      coverage: state.coverage,
      entities: merged.entities,
      retries: state.retries,
      chunkCount: total,
      findingCount: merged.findingCount,
      keyPoints: keyPointsOf(merged),
      reviewFlags: state.reviewFlags,
      review: state.review,
      notice: state.notice,
      retryOutcome: state.retryOutcome,
    }
    const done = traceRow('final', 'ok', Date.now() - startedAt, state.notice ? `Kept the first-pass summary. ${detail}` : detail)
    emit({ type: 'node_end', ...done })
    return { outcome, trace: [done] }
  }

  return { split, extract, reduce, synthesize, check, final }
}
