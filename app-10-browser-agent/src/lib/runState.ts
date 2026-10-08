import type { BotStep, ObservedPage, PlanResponse, RunEvent, TraceEntry, TraceStatus, UsageReport } from '../types'

export type Phase = 'idle' | 'planning' | 'running' | 'complete' | 'failed' | 'stopped'

/** One row of the browser run: a stage, or a planned step. `running` is a display state only. */
export interface RunRow {
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
      return { ...state, phase: 'failed', error: { message: event.message, index: event.index } }
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
      return { ...initialRunState, phase: 'failed', planTrace: action.trace, error: { message: action.message, index: null } }
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
      return { ...state, phase: 'failed', rows: failRunning(state.rows), error: { message: action.message, index: null } }
    case 'streamEnded':
      return state.phase === 'running'
        ? { ...state, phase: 'failed', rows: failRunning(state.rows), error: { message: 'The run ended before it reported a result.', index: null } }
        : state
    case 'stopped':
      return {
        ...state,
        phase: 'stopped',
        rows: state.rows.map((row) => (row.status === 'running'
          ? { ...row, status: 'skipped', detail: 'Stopped before this step finished.' }
          : row)),
      }
    case 'reset':
      return initialRunState
  }
}
