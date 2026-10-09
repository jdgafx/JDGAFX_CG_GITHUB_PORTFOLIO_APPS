import type { BotStep, ObservedPage, TraceStatus } from '../types'
import type { RunState } from './runState'
import { stepLabel } from './shared'

/** One line of the run trace. `running`, `waiting` and `skipped` are display states, not server statuses. */
export interface TraceRow {
  key: string
  name: string
  status: TraceStatus | 'running' | 'waiting'
  ms: number | null
  detail: string
  planned?: string
  observed?: ObservedPage
}

export interface Metric {
  label: string
  value: string
  hint: string
}

export function formatMs(ms: number): string {
  return `${ms.toLocaleString('en-US')} ms`
}

const usdFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
})

function countOf(value: number | null, planned: boolean): string {
  if (value !== null) return value.toLocaleString('en-US')
  return planned ? 'not reported' : '—'
}

/** Planner stages first, then the browser run, then planned steps the run has not reached yet. */
export function buildTraceRows(state: RunState): TraceRow[] {
  const planRows = state.planTrace.map((entry, i): TraceRow => ({
    key: `plan-${i}`,
    name: entry.name,
    status: entry.status,
    ms: entry.ms,
    detail: entry.detail,
  }))
  if (state.phase === 'planning') {
    return [...planRows, { key: 'planning', name: 'Planning the steps', status: 'running', ms: null, detail: 'Waiting for the model to answer.' }]
  }

  const runRows = state.rows.map((row, i): TraceRow => ({
    key: `run-${i}`,
    name: row.name,
    status: row.status,
    ms: row.status === 'running' ? null : row.ms,
    detail: row.detail,
    planned: row.index === null ? undefined : state.steps[row.index]?.thought,
    observed: row.observed,
  }))

  const reached = new Set(state.rows.map((row) => row.index))
  const ended = state.phase !== 'running'
  const reason = state.phase === 'stopped' ? 'Not run: the run was stopped.' : 'Not run: an earlier stage failed.'
  const pending = state.steps.flatMap((step, index): TraceRow[] => (reached.has(index)
    ? []
    : [{
        key: `pending-${index}`,
        name: stepLabel(step),
        status: ended ? 'skipped' : 'waiting',
        ms: null,
        detail: ended ? reason : 'Waits for the steps before it.',
        planned: step.thought,
      }]))

  // The session release closes the run, so it stays last even when steps that never ran follow it.
  const releaseLast = runRows[runRows.length - 1]?.name === 'Release browser session'
  return releaseLast
    ? [...planRows, ...runRows.slice(0, -1), ...pending, ...runRows.slice(-1)]
    : [...planRows, ...runRows, ...pending]
}

export type PlanStatus = 'waiting' | 'running' | 'ok' | 'failed' | 'skipped'

/** One planned step and its state in this run. */
export interface PlanItem {
  key: string
  label: string
  thought: string
  status: PlanStatus
}

/**
 * Every planned step with its state. A step with no row yet waits while the run is live, and is
 * skipped once the run has ended without reaching it.
 */
export function planItems(state: RunState): PlanItem[] {
  const ended = state.phase === 'complete' || state.phase === 'failed' || state.phase === 'stopped'
  return state.steps.map((step, index): PlanItem => {
    const row = state.rows.find((candidate) => candidate.index === index)
    let status: PlanStatus = ended ? 'skipped' : 'waiting'
    if (row) status = row.status
    return { key: `step-${index}`, label: stepLabel(step), thought: step.thought, status }
  })
}

export function statusSummary(state: RunState): string {
  const total = state.steps.length
  switch (state.phase) {
    case 'idle':
      return 'No run yet.'
    case 'planning':
      return 'Planning the steps.'
    case 'running': {
      const live = state.rows.find((row) => row.status === 'running')
      return live && live.index !== null
        ? `Running step ${live.index + 1} of ${total}: ${live.name}.`
        : 'Starting the browser session.'
    }
    case 'complete':
      return `All ${total} steps finished. Check the observed page against your task.`
    case 'stopped': {
      const finished = state.rows.filter((row) => row.status === 'ok' && row.index !== null).length
      return `Stopped after ${finished} of ${total} steps. No task result was produced.`
    }
    case 'failed': {
      const error = state.error
      if (!error) return 'The run failed.'
      if (error.index === null || total === 0) return error.message
      return `Step ${error.index + 1} of ${total} failed: ${error.message}`
    }
  }
}

function latencyHint(state: RunState): string {
  if (state.runMs === null) return 'Shown once the browser run finishes.'
  if (state.planMs === null) return 'Browser run only. A replay makes no model call.'
  return `Planner ${formatMs(state.planMs)}, browser ${formatMs(state.runMs)}.`
}

/** Figures the provider did not report read "not reported". Nothing is estimated or invented. */
export function metricsFor(state: RunState): Metric[] {
  const usage = state.usage
  const planned = usage !== null
  const latency = state.runMs === null ? null : (state.planMs ?? 0) + state.runMs
  return [
    { label: 'Served model', value: state.model ?? (planned ? 'not reported' : '—'), hint: 'Reported by the planner response' },
    { label: 'Prompt tokens', value: countOf(usage?.prompt_tokens ?? null, planned), hint: 'Planner call' },
    { label: 'Completion tokens', value: countOf(usage?.completion_tokens ?? null, planned), hint: 'Planner call' },
    { label: 'Total tokens', value: countOf(usage?.total_tokens ?? null, planned), hint: 'Planner call' },
    {
      label: 'Cost (USD)',
      value: usage?.cost != null ? usdFormat.format(usage.cost) : planned ? 'not reported' : '—',
      hint: 'From usage.cost in the provider response',
    },
    { label: 'Total latency', value: latency === null ? '—' : formatMs(latency), hint: latencyHint(state) },
  ]
}

/** The planner's stated expectation: the last extract or verify step, in its own words. */
export function expectationOf(steps: BotStep[]): string | null {
  const last = [...steps].reverse().find((step) => step.action === 'extract' || step.action === 'verify')
  return last ? [last.target, last.value].filter(Boolean).join(': ') : null
}
