import { TRACE_STAGES, type TraceStep } from './api'
import type { RunStatus } from './insightRun'

export type RowState = TraceStep['status'] | 'running' | 'stopped' | 'notRun' | 'waiting'

export interface Row {
  name: string
  state: RowState
  detail: string
  ms?: number
  tokens?: number
  cost?: number
}

/**
 * One row per stage, in the server's order. A received step is matched by name. A stage not yet received is
 * waiting before a run, running or stopped at the point the run is at, and not run after that.
 */
export function buildRows(steps: TraceStep[], status: RunStatus, partialAnswer: boolean): Row[] {
  const firstOpen = TRACE_STAGES.find((stage) => !steps.some((step) => step.name === stage.name))?.name
  const rows: Row[] = TRACE_STAGES.map((stage): Row => {
    const step = steps.find((candidate) => candidate.name === stage.name)
    if (step) return { name: stage.name, state: step.status, detail: step.detail, ms: step.ms, tokens: step.tokens, cost: step.cost }
    if (status === 'idle') return { name: stage.name, state: 'waiting', detail: stage.does }
    if (stage.name === firstOpen && status === 'running') return { name: stage.name, state: 'running', detail: 'In progress' }
    if (stage.name === firstOpen && status === 'stopped') {
      const streaming = stage.name === 'Stream answer' && partialAnswer
      return {
        name: stage.name,
        state: 'stopped',
        detail: streaming ? 'Stopped while the answer was streaming. The text that arrived is kept.' : 'Stopped before this stage ran',
      }
    }
    return { name: stage.name, state: 'notRun', detail: 'Not run' }
  })
  // A stage name this page does not know is still shown, after the five stages, rather than dropped.
  for (const step of steps) {
    if (!TRACE_STAGES.some((stage) => stage.name === step.name)) {
      rows.push({ name: step.name, state: step.status, detail: step.detail, ms: step.ms, tokens: step.tokens, cost: step.cost })
    }
  }
  return rows
}

/**
 * Where each row's bar starts and how long it runs, as shares of the time the finished steps took. While a step is
 * running the axis keeps a quarter of that time free at the right for it, and its bar fills that space.
 */
export function lanes(rows: Row[]): ({ left: number; width: number } | null)[] {
  const done = rows.reduce((sum, row) => sum + (row.ms ?? 0), 0)
  const total = done + (rows.some((row) => row.state === 'running') ? Math.max(done / 4, 1) : 0)
  let offset = 0
  return rows.map((row) => {
    if (row.state === 'running') return { left: (offset / total) * 100, width: 100 - (offset / total) * 100 }
    if (row.ms === undefined || row.ms <= 0 || total === 0) return null
    const lane = { left: (offset / total) * 100, width: (row.ms / total) * 100 }
    offset += row.ms
    return lane
  })
}

