import { metricsFor } from '../../src/lib/metrics'
import type { Frame, Merged, NodeName, Outcome, RunResult, TraceRow } from '../../src/types/frames'
import { createLimiter, type RunBudget } from './budget'
import { BUDGET_MESSAGE, LONG_TEXT_HINT, plainMessage, ProviderError, reportedFailure, RunBudgetError, RunFailure } from './errors'
import type { Resume } from './guard'
import { makeHandoff } from './handoff'
import { buildGraph, type Phase } from './graph'
import { ATTRIBUTE_CALL_TIMEOUT_MS, CHECK_CALL_TIMEOUT_MS, EXTRACT_CALL_TIMEOUT_MS, EXTRACT_CONCURRENCY, RETRY_CALL_TIMEOUT_MS, RETRY_PAUSE_MS, SYNTH, SYNTH_CALL_TIMEOUT_MS } from './models'
import { CALL_TIMEOUT_MS, chat, type ChatFn } from './openrouter'
import { noPointsMessage } from './nodes'
import { loadModelList, type ModelList } from './prices'

/**
 * One request's budget. The live Netlify site closed the function at about 30 s, not at the documented 60 s,
 * so the request ends itself and always has time to write an error frame or the result, then [DONE]. The clock
 * starts only after about 3 s of live start-up and network, so 23 s lands near 26 s on the client, 4 s inside the cut-off
 * once the 1 s grace is counted. An analysis is two requests (request 1: split, extract, reduce; request 2: synthesize,
 * review, final), each with this budget, because synthesis with thinking on can take 17 s or more (models.ts SYNTH_CALL_TIMEOUT_MS).
 * Only request 2 can still retry chunks, and with that much of its budget spent it nearly always skips the retry (MIN_RETRY_BUDGET_MS).
 */
export const RUN_BUDGET_MS = 23_000

export interface PipelineOptions {
  text: string
  /** Which part of the run this request makes. Production runs extract, then synthesize. The default, all, runs the whole graph in one request, for in-process use and tests of single nodes only. */
  phase?: Phase
  /** The key points request 1 handed over, already opened and checked by validateSynthesizeBody. Required for the synthesize phase. */
  resume?: Resume
  /** What request 1 signs its hand-off with (handoff.ts). Required for the extract phase. */
  sealKey?: string
  budget: RunBudget
  sink: (frame: Frame) => void
  /** Timeout for each model call, for tests that script a slow provider. Each role has its own default and none exceeds this. */
  callTimeoutMs?: number
  /** Replaces the provider call. Tests use it to script the model layer. */
  chat?: ChatFn
  /** Replaces the fetch of OpenRouter's model list (prices and the newest model). Tests use it to script the list. */
  models?: Promise<ModelList | null>
  /** Pause before each retry call. Defaults to RETRY_PAUSE_MS. */
  retryPauseMs?: number
  /** Extract calls that run at once. Defaults to EXTRACT_CONCURRENCY. */
  extractConcurrency?: number
  /** Timeout for the retry pass's extract calls. Defaults to RETRY_CALL_TIMEOUT_MS, and never exceeds callTimeoutMs. */
  retryCallTimeoutMs?: number
  /** Timeout for the first-pass extract calls. Defaults to EXTRACT_CALL_TIMEOUT_MS, and never exceeds callTimeoutMs. */
  extractCallTimeoutMs?: number
  /** Timeout for the advisory review call. Defaults to CHECK_CALL_TIMEOUT_MS, and never exceeds callTimeoutMs. */
  checkCallTimeoutMs?: number
  /** Timeout for each attribution call. Defaults to ATTRIBUTE_CALL_TIMEOUT_MS, and never exceeds callTimeoutMs. */
  attributeCallTimeoutMs?: number
  /** Timeout for the synthesis call. Defaults to SYNTH_CALL_TIMEOUT_MS, and never exceeds callTimeoutMs. */
  synthCallTimeoutMs?: number
}

/** The chunks with more than one extract row: asked a second time. */
function retriedChunks(rows: readonly TraceRow[]): number[] {
  const seen = new Map<number, number>()
  for (const row of rows) if (row.node === 'extract' && row.chunk !== undefined) seen.set(row.chunk, (seen.get(row.chunk) ?? 0) + 1)
  return [...seen].filter(([, n]) => n > 1).map(([chunk]) => chunk).sort((a, b) => a - b)
}

/** A text longer than the Wikipedia loader's limit gets the shorter-text hint when the run ran out of time. */
export const LONG_TEXT_CHARS = 10_000
/** After the budget ends, the run waits this long for its nodes to stop, then ends itself. */
export const BUDGET_GRACE_MS = 1_000

/** Shown on a step the time limit cut off. */
export const CUT_OFF_MESSAGE = 'Cut off by the time limit'
/** The detail of the final row when the first-pass summary is what the run returns. */
export const KEPT_FIRST_PASS = 'Kept the first-pass summary'

/** The notice for a retry that did not finish. A timeout or the run budget is not advice to shorten the text. */
function retryNotice(cause: unknown, message: string, expired: boolean): string {
  const slow =
    expired ||
    cause instanceof RunBudgetError ||
    (cause instanceof ProviderError && (cause.kind === 'timeout' || cause.kind === 'unavailable'))
  return slow
    ? 'The retry did not finish in time, so the summary is from the first pass.'
    : `The retry did not finish. ${message} The summary is from the first pass.`
}

/** The check update as the stream carries it. */
interface CheckUpdate {
  decision?: 'retry' | 'final'
  draft?: Outcome | null
}

/** One graph update, keyed by node name. */
interface GraphUpdate {
  reduce?: { merged?: Merged | null }
  check?: CheckUpdate
  final?: { outcome?: Outcome | null }
}

/**
 * Runs the graph and turns its stream into frames. Node frames come from inside the nodes, so they
 * arrive while parallel work is still running. If the retry pass fails after the first pass produced a
 * summary, the first-pass summary is returned with a notice and the gap stays visible. Any other
 * failure ends in one error frame. The caller writes the [DONE] line.
 */
export async function runPipeline(options: PipelineOptions): Promise<void> {
  const { text, budget, sink } = options
  const phase: Phase = options.phase ?? 'all'
  if (phase === 'synthesize' && !options.resume) throw new Error('The synthesize phase needs the key points of the extract phase.')
  if (phase === 'extract' && !options.sealKey) throw new Error('The extract phase needs a key to sign its hand-off with.')
  const call: ChatFn =
    options.chat ?? ((request, signal) => chat(request, signal, options.callTimeoutMs ?? CALL_TIMEOUT_MS))
  // The model list is fetched once per run, while the first model calls run, so it is settled before their replies arrive.
  const models = options.models ?? loadModelList()
  const startedAt = Date.now()
  const rows: TraceRow[] = []
  let outcome: Outcome | null = null
  let firstPass: Outcome | null = null
  let merged: Merged | null = null
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  /** Steps that have started and not ended, with the time they started. */
  const open = new Map<NodeName, number>()

  try {
    const graph = buildGraph(
      {
        chat: call,
        limiter: createLimiter(options.extractConcurrency ?? EXTRACT_CONCURRENCY),
        budget,
        models,
        retryPauseMs: options.retryPauseMs ?? RETRY_PAUSE_MS,
        extractCallTimeoutMs: options.extractCallTimeoutMs ?? Math.min(EXTRACT_CALL_TIMEOUT_MS, options.callTimeoutMs ?? EXTRACT_CALL_TIMEOUT_MS),
        checkCallTimeoutMs: options.checkCallTimeoutMs ?? Math.min(CHECK_CALL_TIMEOUT_MS, options.callTimeoutMs ?? CHECK_CALL_TIMEOUT_MS),
        attributeCallTimeoutMs: options.attributeCallTimeoutMs ?? Math.min(ATTRIBUTE_CALL_TIMEOUT_MS, options.callTimeoutMs ?? ATTRIBUTE_CALL_TIMEOUT_MS),
        synthCallTimeoutMs: options.synthCallTimeoutMs ?? Math.min(SYNTH_CALL_TIMEOUT_MS, options.callTimeoutMs ?? SYNTH_CALL_TIMEOUT_MS),
        retryCallTimeoutMs: options.retryCallTimeoutMs ?? Math.min(RETRY_CALL_TIMEOUT_MS, options.callTimeoutMs ?? RETRY_CALL_TIMEOUT_MS),
      },
      phase,
    )
    // Request 2 starts from the key points request 1 made, with the chunks and findings the server rebuilt from them.
    // A chunk request 1 already asked a second time is not asked a third: request 2 starts with its one retry spent.
    const input = options.resume
      ? { text, chunks: options.resume.chunks, findings: options.resume.findings, merged: options.resume.merged, retries: options.resume.retried.length > 0 ? 1 : 0 }
      : { text }
    const stream = await graph.stream(input, { streamMode: ['custom', 'updates'] })
    // A node that does not stop when the budget ends cannot keep the run open: BUDGET_GRACE_MS later it is abandoned.
    const abandoned = new Promise<never>((_resolve, reject) => {
      const arm = (): void => {
        graceTimer = setTimeout(() => reject(new RunBudgetError()), BUDGET_GRACE_MS)
      }
      if (budget.signal.aborted) arm()
      else budget.signal.addEventListener('abort', arm, { once: true })
    })
    abandoned.catch(() => undefined)
    const updates = stream[Symbol.asyncIterator]()
    for (;;) {
      const next = await Promise.race([updates.next(), abandoned])
      if (next.done) break
      const [mode, payload] = next.value
      if (mode === 'custom') {
        const frame = payload as Frame
        if (frame.type === 'node_start' && frame.node !== 'extract') open.set(frame.node, Date.now())
        if (frame.type === 'node_end') {
          rows.push(frame)
          open.delete(frame.node)
        }
        sink(frame)
      } else {
        const update = payload as GraphUpdate
        if (update.reduce?.merged) merged = update.reduce.merged
        // A check that schedules the retry leaves the first-pass outcome behind as its draft.
        if (update.check?.decision === 'retry' && update.check.draft) firstPass = update.check.draft
        if (update.final?.outcome) outcome = update.final.outcome
      }
    }
    if (phase === 'extract') {
      // Request 1 ends with the key points for request 2. With none, there is nothing to summarize, and the run says why.
      if (!merged || merged.byChunk.length === 0) throw new RunFailure(noPointsMessage(rows))
      sink({ type: 'handoff', handoff: makeHandoff(options.sealKey ?? '', text, merged, Date.now(), retriedChunks(rows)) })
      return
    }
    if (!outcome) throw new RunFailure('The run ended before the summary was ready.')
    const result: RunResult = { ...outcome, metrics: metricsFor(rows, Date.now() - startedAt) }
    sink({ type: 'result', result })
  } catch (err) {
    const cause = budget.haltCause() ?? reportedFailure(err)
    let message = plainMessage(cause, budget.expired())
    if (message === BUDGET_MESSAGE && text.length > LONG_TEXT_CHARS) message += LONG_TEXT_HINT
    if (firstPass && !outcome) {
      const write = (row: TraceRow): void => {
        rows.push(row)
        sink({ type: 'node_end', ...row })
      }
      // The pass-2 steps the limit cut off end as failed rows, and the run ends with a final row like any other.
      for (const [node, began] of open) {
        // A synthesis call that was in flight when the limit hit has no reply to count: its row names the model and the totals say not reported. Key point checks and the review write their own rows when they are cut off.
        const model = node === 'synthesize' ? SYNTH.model : undefined
        write({ node, status: 'failed', ms: Date.now() - began, detail: CUT_OFF_MESSAGE, message: CUT_OFF_MESSAGE, ...(model ? { model } : {}) })
      }
      sink({ type: 'node_start', node: 'final', ms: budget.elapsed(), detail: 'Finishing the run' })
      write({ node: 'final', status: 'ok', ms: 0, detail: KEPT_FIRST_PASS })
      const result: RunResult = {
        ...firstPass,
        notice: retryNotice(cause, message, budget.expired()),
        retryOutcome: 'skipped',
        metrics: metricsFor(rows, Date.now() - startedAt),
      }
      sink({ type: 'result', result })
    } else {
      sink({ type: 'error', message })
    }
  } finally {
    clearTimeout(graceTimer)
  }
}
