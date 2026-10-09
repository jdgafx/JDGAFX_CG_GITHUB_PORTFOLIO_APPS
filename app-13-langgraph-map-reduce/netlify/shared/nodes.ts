import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import type { Chunk, Finding, Frame, NodeName, Outcome, TraceRow } from '../../src/types/frames'
import { pause, type Limiter, type RunBudget } from './budget'
import { CHUNK_TARGET, splitText } from './chunk'
import { citedChunks, computeCoverage } from './coverage'
import { readCost } from './cost'
import { ProviderError, RunFailure, plainMessage } from './errors'
import type { GraphStateType } from './graph-state'
import { mergeFindings } from './merge'
import { CHECK, EXTRACT, MAX_RETRIES, MIN_RETRY_BUDGET_MS, RETRY_PAUSE_MS, SYNTH } from './models'
import type { ChatFn, ChatReply } from './openrouter'
import { parseExtraction, parseOmitted, parseSummary } from './parse'
import { checkMessages, extractMessages, synthesizeMessages } from './prompts'

export interface NodeDeps {
  chat: ChatFn
  limiter: Limiter
  budget: RunBudget
  /** Pause before each retry call. Defaults to RETRY_PAUSE_MS. */
  retryPauseMs?: number
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

function emitterFor(config: LangGraphRunnableConfig | undefined): Emit {
  const writer = config?.writer
  return (frame) => {
    if (writer) writer(frame)
  }
}

function traceRow(
  node: NodeName,
  status: TraceRow['status'],
  ms: number,
  detail: string,
  extra: Partial<TraceRow> = {},
): TraceRow {
  return { node, status, ms, detail, ...extra }
}

/** Model, usage and cost of one call. The model shown is the one that served it. Cost is priced at the requested model. */
function callFields(requested: string, reply: ChatReply): Partial<TraceRow> {
  const reading = readCost(requested, reply.usage, reply.cost)
  return {
    model: reply.servedModel ?? requested,
    ...(reply.usage ? { usage: reply.usage } : {}),
    ...(reading ? { cost: reading.cost, costSource: reading.source } : {}),
  }
}

function noPointsMessage(trace: TraceRow[]): string {
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
  const { chat, limiter, budget } = deps
  const retryPause = deps.retryPauseMs ?? RETRY_PAUSE_MS

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
      `${chunks.length} chunks of about ${CHUNK_TARGET.toLocaleString('en-US')} characters`,
    )
    emit({ type: 'node_end', ...done })
    emit({ type: 'edge', from: 'split', to: 'extract', label: `fan out: ${chunks.length} chunks`, count: chunks.length })
    return { chunks, trace: [done] }
  }

  /**
   * One chunk. It is announced as started when the limiter hands it a slot, and its row is written before
   * the slot is given up, so a waiting chunk is never shown as running and at most EXTRACT_CONCURRENCY
   * chunks are open at once. A rate limit, a timeout, a server error or a refused request costs this
   * chunk only, and the coverage check may retry it once after a pause. A rejected key halts every
   * parallel call.
   */
  const extract = async (input: ExtractInput, config?: LangGraphRunnableConfig): Promise<Update> => {
    const emit = emitterFor(config)
    const { chunk, total, pass } = input
    const label = pass === 2 ? `chunk ${chunk.id} of ${total} (retry)` : `chunk ${chunk.id} of ${total}`

    const fail = (err: unknown, spent: number): Attempt => {
      const row = traceRow('extract', 'failed', spent, label, {
        chunk: chunk.id,
        model: EXTRACT.model,
        message: extractFailureText(err, budget),
      })
      emit({ type: 'node_end', ...row })
      return { error: err, row }
    }

    const finish = (reply: ChatReply, callMs: number): Attempt => {
      const fields = callFields(EXTRACT.model, reply)
      const parsed = parseExtraction(reply.text)
      if (!parsed || parsed.points.length === 0) {
        const row = traceRow('extract', 'failed', callMs, label, {
          chunk: chunk.id,
          message: 'The model reply had no key points.',
          ...fields,
        })
        emit({ type: 'node_end', ...row })
        return { update: { trace: [row] } }
      }
      const finding: Finding = {
        chunkId: chunk.id,
        points: parsed.points,
        entities: parsed.entities,
        model: fields.model ?? EXTRACT.model,
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
          return finish(await chat({ ...EXTRACT, messages: extractMessages(chunk, total) }, budget.signal), Date.now() - began)
        } catch (err) {
          if (err instanceof ProviderError && err.fatal) budget.halt(err)
          return fail(err, Date.now() - began)
        }
      }, budget.signal)
    } catch (err) {
      // The pause or the queue ended before this chunk's call began.
      attempt = fail(err, 0)
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
      `Merged ${merged.findingCount} findings into ${merged.byChunk.length} chunks, ${merged.entities.length} unique entities`,
    )
    emit({ type: 'node_end', ...done })
    return { merged, trace: [done] }
  }

  const synthesize = async (state: GraphStateType, config?: LangGraphRunnableConfig): Promise<Update> => {
    const emit = emitterFor(config)
    emit({ type: 'node_start', node: 'synthesize', ms: budget.elapsed(), detail: 'Writing the cited summary' })
    const merged = state.merged
    if (!merged || merged.byChunk.length === 0) throw new RunFailure(noPointsMessage(state.trace))
    const chunkIds = state.chunks.map((c) => c.id)
    const withPoints = new Set(merged.byChunk.map((c) => c.chunkId))
    const missed = state.coverage.missing.filter((id) => withPoints.has(id))

    const startedAt = Date.now()
    const reply = await chat({ ...SYNTH, messages: synthesizeMessages(merged, chunkIds, missed) }, budget.signal)
    const ms = Date.now() - startedAt
    const fields = callFields(SYNTH.model, reply)
    const summary = parseSummary(reply.text, chunkIds)
    if (!summary) {
      throw new RunFailure(
        reply.finishReason === 'length'
          ? 'The summary was cut short. Please run the text again.'
          : 'The summary could not be read. Please run the text again.',
      )
    }
    const points = summary.sections.reduce((n, s) => n + s.points.length, 0)
    const note = missed.length > 0 ? `, retry asks for chunk ${missed.join(', ')}` : ''
    const done = traceRow('synthesize', 'ok', ms, `${summary.sections.length} sections, ${points} points${note}`, fields)
    emit({ type: 'node_end', ...done })
    return { summary, trace: [done] }
  }

  /**
   * Deterministic coverage, plus one review call that lists omitted chunks. A chunk is covered when it
   * has points, the summary cites it and the review does not flag it. The retry counter moves here, so
   * the router only reads the decision this node writes. Every pass also leaves its outcome as the draft,
   * which a failed retry returns.
   */
  const check = async (state: GraphStateType, config?: LangGraphRunnableConfig): Promise<Update> => {
    const emit = emitterFor(config)
    emit({ type: 'node_start', node: 'check', ms: budget.elapsed(), detail: 'Checking coverage' })
    const merged = state.merged
    const summary = state.summary
    if (!merged || !summary) throw new RunFailure('There is no summary to check.')
    const chunkIds = state.chunks.map((c) => c.id)
    const cited = citedChunks(summary, chunkIds)
    const withPoints = new Set(merged.byChunk.map((c) => c.chunkId))

    let flagged = new Set<number>()
    let done: TraceRow
    const startedAt = Date.now()
    try {
      const reply = await chat({ ...CHECK, messages: checkMessages(summary, merged) }, budget.signal)
      const ms = Date.now() - startedAt
      const fields = callFields(CHECK.model, reply)
      const omitted = parseOmitted(reply.text, chunkIds)
      if (omitted === null) {
        done = traceRow('check', 'failed', ms, 'Review reply was not readable. Coverage uses chunk citations only.', fields)
      } else {
        flagged = new Set(omitted)
        done = traceRow('check', 'ok', ms, `Review flagged ${omitted.length} chunks as omitted`, fields)
      }
    } catch (err) {
      // The review is a second opinion. A failure here never discards a finished summary.
      if (!(err instanceof ProviderError) || budget.expired()) throw err
      done = traceRow(
        'check',
        'failed',
        Date.now() - startedAt,
        `Review unavailable: ${err.message} Coverage uses chunk citations only.`,
      )
    }

    const coverage = computeCoverage({ chunkIds, withPoints, cited, flagged })
    const wantsRetry = coverage.missing.length > 0 && state.retries < MAX_RETRIES
    const skipRetry = wantsRetry && budget.remaining() < MIN_RETRY_BUDGET_MS
    const willRetry = wantsRetry && !skipRetry
    const notice = skipRetry ? RETRY_SKIPPED_NOTICE : null
    emit({ type: 'node_end', ...done })
    if (willRetry) {
      emit({ type: 'edge', from: 'check', to: 'extract', label: `retry ${coverage.missing.length} missing chunks` })
    } else {
      emit({
        type: 'edge',
        from: 'check',
        to: 'final',
        label:
          coverage.missing.length === 0
            ? 'coverage complete'
            : skipRetry
              ? `${coverage.missing.length} ${coverage.missing.length === 1 ? 'chunk' : 'chunks'} still missing, retry skipped for time`
              : `${coverage.missing.length} ${coverage.missing.length === 1 ? 'chunk' : 'chunks'} still missing after the retry`,
      })
    }
    const draft: Outcome = {
      summary,
      coverage,
      entities: merged.entities,
      retries: state.retries,
      chunkCount: chunkIds.length,
      findingCount: merged.findingCount,
      notice,
    }
    return {
      coverage,
      notice,
      decision: willRetry ? 'retry' : 'final',
      retries: willRetry ? state.retries + 1 : state.retries,
      draft,
      trace: [done],
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
    const detail =
      missing.length === 0
        ? `${total} of ${total} chunks covered`
        : `${state.coverage.covered.length} of ${total} chunks covered. Still missing: chunk ${missing.join(', ')}`
    const outcome: Outcome = {
      summary: state.summary,
      coverage: state.coverage,
      entities: merged.entities,
      retries: state.retries,
      chunkCount: total,
      findingCount: merged.findingCount,
      notice: state.notice,
    }
    const done = traceRow('final', 'ok', Date.now() - startedAt, detail)
    emit({ type: 'node_end', ...done })
    return { outcome, trace: [done] }
  }

  return { split, extract, reduce, synthesize, check, final }
}
