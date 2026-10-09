import { metricsFor } from '../../src/lib/metrics'
import type { Frame, NodeName, Outcome, RunResult, TraceRow } from '../../src/types/frames'
import { createLimiter, type RunBudget } from './budget'
import { BUDGET_MESSAGE, LONG_TEXT_HINT, plainMessage, ProviderError, reportedFailure, RunBudgetError, RunFailure } from './errors'
import { buildGraph } from './graph'
import { CHECK_CALL_TIMEOUT_MS, EXTRACT_CALL_TIMEOUT_MS, EXTRACT_CONCURRENCY, RETRY_CALL_TIMEOUT_MS, RETRY_PAUSE_MS } from './models'
import { CALL_TIMEOUT_MS, chat, type ChatFn } from './openrouter'

/**
 * One run's budget. The live Netlify site closed the function at about 30 s, not at the documented 60 s,
 * so the run ends itself and always has time to write an error frame or the result, then [DONE]. The clock
 * starts only after about 3 s of live start-up and network, so 23 s lands near 26 s on the client.
 */
export const RUN_BUDGET_MS = 23_000

export interface PipelineOptions {
  text: string
  budget: RunBudget
  sink: (frame: Frame) => void
  /** Timeout for each model call. Defaults to 10 s. */
  callTimeoutMs?: number
  /** Replaces the provider call. Tests use it to script the model layer. */
  chat?: ChatFn
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
  const call: ChatFn =
    options.chat ?? ((request, signal) => chat(request, signal, options.callTimeoutMs ?? CALL_TIMEOUT_MS))
  const startedAt = Date.now()
  const rows: TraceRow[] = []
  let outcome: Outcome | null = null
  let firstPass: Outcome | null = null
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  /** Steps that have started and not ended, with the time they started. */
  const open = new Map<NodeName, number>()

  try {
    const graph = buildGraph({
      chat: call,
      limiter: createLimiter(options.extractConcurrency ?? EXTRACT_CONCURRENCY),
      budget,
      retryPauseMs: options.retryPauseMs ?? RETRY_PAUSE_MS,
      extractCallTimeoutMs: options.extractCallTimeoutMs ?? Math.min(EXTRACT_CALL_TIMEOUT_MS, options.callTimeoutMs ?? EXTRACT_CALL_TIMEOUT_MS),
      checkCallTimeoutMs: options.checkCallTimeoutMs ?? Math.min(CHECK_CALL_TIMEOUT_MS, options.callTimeoutMs ?? CHECK_CALL_TIMEOUT_MS),
      retryCallTimeoutMs: options.retryCallTimeoutMs ?? Math.min(RETRY_CALL_TIMEOUT_MS, options.callTimeoutMs ?? RETRY_CALL_TIMEOUT_MS),
    })
    const stream = await graph.stream(
      { text },
      { streamMode: ['custom', 'updates'] },
    )
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
        // A check that schedules the retry leaves the first-pass outcome behind as its draft.
        if (update.check?.decision === 'retry' && update.check.draft) firstPass = update.check.draft
        if (update.final?.outcome) outcome = update.final.outcome
      }
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
        write({ node, status: 'failed', ms: Date.now() - began, detail: CUT_OFF_MESSAGE, message: CUT_OFF_MESSAGE })
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
