import { randomUUID } from 'node:crypto'
import { metricsFor } from '../../src/lib/metrics'
import type { Frame, Outcome, RunResult, TraceRow } from '../../src/types/frames'
import { createLimiter, type RunBudget } from './budget'
import { plainMessage, reportedFailure, RunFailure } from './errors'
import { buildGraph } from './graph'
import { EXTRACT_CONCURRENCY, RETRY_PAUSE_MS } from './models'
import { CALL_TIMEOUT_MS, chat, type ChatFn } from './openrouter'

/** One run's budget. Netlify's synchronous limit is 60 s, so the run stops well before it. */
export const RUN_BUDGET_MS = 50_000

export interface PipelineOptions {
  text: string
  budget: RunBudget
  sink: (frame: Frame) => void
  /** Timeout for each model call. Defaults to 20 s. */
  callTimeoutMs?: number
  /** Replaces the provider call. Tests use it to script the model layer. */
  chat?: ChatFn
  /** Pause before each retry call. Defaults to RETRY_PAUSE_MS. */
  retryPauseMs?: number
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

  try {
    const graph = buildGraph({
      chat: call,
      limiter: createLimiter(EXTRACT_CONCURRENCY),
      budget,
      retryPauseMs: options.retryPauseMs ?? RETRY_PAUSE_MS,
    })
    const stream = await graph.stream(
      { text },
      { streamMode: ['custom', 'updates'], configurable: { thread_id: randomUUID() } },
    )
    for await (const [mode, payload] of stream) {
      if (mode === 'custom') {
        const frame = payload as Frame
        if (frame.type === 'node_end') rows.push(frame)
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
    const message = plainMessage(budget.haltCause() ?? reportedFailure(err), budget.expired())
    if (firstPass && !outcome) {
      const result: RunResult = {
        ...firstPass,
        notice: `The retry did not finish. ${message} The summary is from the first pass.`,
        metrics: metricsFor(rows, Date.now() - startedAt),
      }
      sink({ type: 'result', result })
    } else {
      sink({ type: 'error', message })
    }
  }
}
