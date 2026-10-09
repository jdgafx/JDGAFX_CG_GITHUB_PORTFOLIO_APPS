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

  // The browser close ends the run, so it stays last even when steps that never ran follow it.
  const releaseLast = runRows[runRows.length - 1]?.name === 'Close browser'
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
        : 'Starting the browser.'
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
      if (total === 0) return 'Stopped before planning. The reason is above.'
      if (error.index === null) return error.message
      return `Step ${error.index + 1} of ${total} failed: ${error.message}`
    }
  }
}

/** One cell of the run readout. */
export interface ReadoutCell {
  label: string
  value: string
  hint: string
}

/** Milliseconds spent so far: the planner rows plus the browser rows, the same figures the trace shows. */
function spentMs(state: RunState): number {
  return state.planTrace.reduce((sum, entry) => sum + entry.ms, 0) + state.rows.reduce((sum, row) => sum + (row.status === 'running' ? 0 : row.ms), 0)
}

/**
 * The four readout cells. While the run is live, Time counts up from its start (`now` is the clock reading).
 * A figure the provider did not report reads "not reported". Nothing is estimated or invented.
 */
export function readoutFor(state: RunState, now: number): ReadoutCell[] {
  const usage = state.usage
  const planned = usage !== null
  const live = state.phase === 'planning' || state.phase === 'running'
  const ended = state.phase === 'failed' || state.phase === 'stopped'
  const sofar = state.phase === 'failed' ? 'Before it failed' : 'Before it stopped'

  let time = { value: '—', hint: 'Shown while it runs' }
  if (live && state.startedAt !== null) time = { value: formatMs(Math.max(0, Math.round((now - state.startedAt) / 100) * 100)), hint: 'So far' }
  else if (state.runMs !== null) {
    time = {
      value: formatMs((state.planMs ?? 0) + state.runMs),
      hint: state.planMs === null ? 'Browser run only, no model call' : `Planner ${formatMs(state.planMs)}, browser ${formatMs(state.runMs)}`,
    }
  } else if (ended) time = { value: formatMs(spentMs(state)), hint: sofar }

  const prompt = usage?.prompt_tokens ?? null
  const completion = usage?.completion_tokens ?? null
  const hint = prompt !== null && completion !== null ? `${prompt.toLocaleString('en-US')} in, ${completion.toLocaleString('en-US')} out` : 'Planner call'
  return [
    { label: 'Time', ...time },
    { label: 'Tokens', value: countOf(usage?.total_tokens ?? null, planned), hint },
    { label: 'Cost (USD)', value: usage?.cost != null ? usdFormat.format(usage.cost) : planned ? 'not reported' : '—', hint: 'From usage.cost in the provider response' },
    { label: 'Model', value: state.model ?? (planned ? 'not reported' : '—'), hint: 'Reported by the planner response' },
  ]
}

/** The planner's stated expectation: the last extract or verify step, in its own words. */
export function expectationOf(steps: BotStep[]): string | null {
  const last = [...steps].reverse().find((step) => step.action === 'extract' || step.action === 'verify')
  return last ? [last.target, last.value].filter(Boolean).join(': ') : null
}

/** Where a row's bar sits on the trace lane, in percent. Rows run one after another, so each starts where the last measured row ended. */
export function lanesFor(rows: TraceRow[]): Array<{ left: number; width: number } | null> {
  const timed = rows.map((row) => ((row.status === 'ok' || row.status === 'failed') && row.ms !== null ? row.ms : null))
  const total = timed.reduce<number>((sum, ms) => sum + (ms ?? 0), 0)
  if (total === 0) return rows.map(() => null)
  let before = 0
  return timed.map((ms) => {
    if (ms === null) return null
    const left = (before / total) * 100
    before += ms
    return { left, width: Math.min(100 - left, Math.max(1.5, (ms / total) * 100)) }
  })
}
