import type { AgentRole, AgentState } from '../types'
import { summaryLine } from './audit'
import type { AuditView } from './auditState'
import { formatUsd } from './usage'
import type { Mark, Step } from './graphLayout'
import { retryLine, traceDetail, traceMeta } from './pipeline'

export interface TraceRow {
  id: string
  index: number
  name: string
  mark: Mark
  word: string
  ms?: number
  detail: string
  meta: string[]
}

function auditDetail(view: AuditView): string {
  switch (view.phase) {
    case 'idle':
      return 'Waits for the finished report.'
    case 'none':
      return view.note ?? 'Nothing to check.'
    case 'running':
      return `Checking ${view.summary.total} cited ${view.summary.total === 1 ? 'claim' : 'claims'} against the text of their sources.`
    case 'done':
      return summaryLine(view.summary)
    case 'failed':
      return view.error ?? 'The audit failed.'
    case 'stopped':
      return 'Stopped before it finished.'
  }
}

function auditMeta(view: AuditView): string[] {
  const result = view.result
  if (view.phase !== 'done' || !result) return []
  const tokens = result.usage.completion_tokens
  return [
    ...retryLine(result.retried),
    tokens !== undefined ? `${tokens.toLocaleString('en-US')} output tokens` : 'output tokens not reported',
    result.usage.cost !== undefined ? formatUsd(result.usage.cost) : 'cost not reported',
  ]
}

/** One numbered line per step, the six boxes of the graph, with the detail and figures the trace shows. */
export function buildTraceRows(steps: Step[], agents: Record<AgentRole, AgentState>, audit: AuditView): TraceRow[] {
  return steps.map((step, i) => {
    const agent = step.id === 'audit' ? null : agents[step.id]
    return {
      id: step.id,
      index: i + 1,
      name: step.title,
      mark: step.mark,
      word: step.word,
      ...(step.ms !== undefined ? { ms: step.ms } : {}),
      detail: agent ? traceDetail(agent) : auditDetail(audit),
      meta: agent ? traceMeta(agent) : auditMeta(audit),
    }
  })
}

/** Where each finished step sits on one shared time axis: a step starts where the one before it ended. */
export function laneFor(rows: TraceRow[]): Array<{ left: number; width: number } | null> {
  const spent = rows.reduce((sum, row) => sum + (row.ms ?? 0), 0)
  const axis = Math.max(spent, 1) * (rows.some(row => row.mark === 'active') ? 1.15 : 1)
  let at = 0
  return rows.map(row => {
    const left = (at / axis) * 100
    at += row.ms ?? 0
    if (row.ms === undefined) return row.mark === 'active' ? { left, width: Math.max(100 - left, 2) * 0.12 } : null
    return { left, width: Math.max((row.ms / axis) * 100, 0.8) }
  })
}
