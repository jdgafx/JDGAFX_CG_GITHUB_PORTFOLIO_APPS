import type { BotStep, ObservedPage, PlanResponse, RunEvent, TraceEntry, TraceStatus, UsageReport } from '../types'

export type Phase = 'idle' | 'planning' | 'running' | 'complete' | 'failed' | 'stopped'

const ENDED_EARLY = 'The run ended before it reported a result.'
const RELEASE_ROW = 'Release browser session'
/** Stop ends the stream, so the server's release result never arrives. The row says what happens instead. */
const RELEASE_AFTER_STOP = 'Stop ends the stream. The server releases the session when its current step ends, or Browserbase ends it at the 120 s cap. The result is not reported to this page.'

/** One row of the browser run: a stage, or a planned step. `running` is a display state only. */
interface RunRow {
  index: number | null
  name: string
  status: TraceStatus | 'running'
  ms: number
  detail: string
  observed?: ObservedPage
}

export interface RunState {
  phase: Phase
  steps: BotStep[]
  planTrace: TraceEntry[]
  usage: UsageReport | null
  model: string | null
  planMs: number | null
  rows: RunRow[]
  runMs: number | null
  sessionId: string | null
  observed: ObservedPage | null
  error: { message: string; index: number | null } | null
}

export const initialRunState: RunState = {
  phase: 'idle',
  steps: [],
  planTrace: [],
  usage: null,
  model: null,
  planMs: null,
  rows: [],
  runMs: null,
  sessionId: null,
  observed: null,
  error: null,
}

export type RunAction =
  | { type: 'planning' }
  | { type: 'planned'; plan: PlanResponse }
  | { type: 'planFailed'; message: string; trace: TraceEntry[] }
  | { type: 'running'; replay: boolean }
  | { type: 'event'; event: RunEvent }
  | { type: 'runFailed'; message: string }
  | { type: 'streamEnded' }
  | { type: 'stopped' }
  | { type: 'reset' }

/** A row for the same planned step replaces the earlier one (its running placeholder), in place. */
function upsertRow(rows: RunRow[], row: RunRow): RunRow[] {
  const at = row.index === null ? -1 : rows.findIndex((existing) => existing.index === row.index)
  if (at === -1) return [...rows, row]
  return rows.map((existing, i) => (i === at ? row : existing))
}

/** A row still marked running has no result. Once the stream fails, it is a failure. */
function failRunning(rows: RunRow[]): RunRow[] {
  return rows.map((row) => (row.status === 'running'
    ? { ...row, status: 'failed', detail: 'No result arrived for this step.' }
    : row))
}

/** A failed run always leaves a failed row in the trace, even when the server sent no failed row. */
function withFailedRow(rows: RunRow[], message: string): RunRow[] {
  if (rows.some((row) => row.status === 'failed')) return rows
  return [...rows, { index: null, name: 'Browser run', status: 'failed', ms: 0, detail: message }]
}

/** A failed planning request leaves a failed entry in the trace, even when it never reached the server. */
function withFailedEntry(trace: TraceEntry[], message: string): TraceEntry[] {
  if (trace.some((entry) => entry.status === 'failed')) return trace
  return [...trace, { name: 'Planner request', status: 'failed', ms: 0, detail: message }]
}

function applyEvent(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'session':
      return { ...state, sessionId: event.sessionId }
    case 'stage':
      return {
        ...state,
        rows: [...state.rows, { index: null, name: event.name, status: event.status, ms: event.ms, detail: event.detail }],
      }
    case 'step_start':
      return {
        ...state,
        rows: upsertRow(state.rows, { index: event.index, name: event.name, status: 'running', ms: 0, detail: 'Running.' }),
      }
    case 'step_complete':
      return {
        ...state,
        rows: upsertRow(state.rows, {
          index: event.index,
          name: event.name,
          status: event.status,
          ms: event.ms,
          detail: event.detail,
          observed: event.observed,
        }),
        observed: event.observed ?? state.observed,
      }
    case 'result':
      return {
        ...state,
        rows: [...state.rows, {
          index: null,
          name: 'Read final page',
          status: 'ok',
          ms: event.ms,
          detail: `Final page: ${event.observed.title || event.observed.url}.`,
          observed: event.observed,
        }],
        observed: event.observed,
      }
    case 'error':
      return {
        ...state,
        phase: 'failed',
        rows: withFailedRow(state.rows, event.message),
        error: { message: event.message, index: event.index },
      }
    case 'done':
      return state.phase === 'failed' ? state : { ...state, phase: 'complete', runMs: event.totalMs }
  }
}

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'planning':
      return { ...initialRunState, phase: 'planning' }
    case 'planned':
      return {
        ...state,
        steps: action.plan.result.steps,
        planTrace: action.plan.trace,
        usage: action.plan.usage,
        model: action.plan.model,
        planMs: action.plan.totalMs,
      }
    case 'planFailed':
      return {
        ...initialRunState,
        phase: 'failed',
        planTrace: withFailedEntry(action.trace, action.message),
        error: { message: action.message, index: null },
      }
    case 'running':
      // A replay makes no model call, so its latency leaves out the planner time.
      return {
        ...state,
        phase: 'running',
        planMs: action.replay ? null : state.planMs,
        rows: [],
        runMs: null,
        sessionId: null,
        observed: null,
        error: null,
      }
    case 'event':
      return applyEvent(state, action.event)
    case 'runFailed':
      return {
        ...state,
        phase: 'failed',
        rows: withFailedRow(failRunning(state.rows), action.message),
        error: { message: action.message, index: null },
      }
    case 'streamEnded':
      return state.phase === 'running'
        ? {
            ...state,
            phase: 'failed',
            rows: withFailedRow(failRunning(state.rows), ENDED_EARLY),
            error: { message: ENDED_EARLY, index: null },
          }
        : state
    case 'stopped':
      return {
        ...state,
        phase: 'stopped',
        rows: [
          ...state.rows.map((row): RunRow => (row.status === 'running'
            ? { ...row, status: 'skipped', detail: 'Stopped before this step finished.' }
            : row)),
          { index: null, name: RELEASE_ROW, status: 'skipped', ms: 0, detail: RELEASE_AFTER_STOP },
        ],
      }
    case 'reset':
      return initialRunState
  }
}
