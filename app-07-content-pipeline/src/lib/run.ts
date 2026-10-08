import { STAGE_IDS, STAGE_LABELS, type CallRecord, type StageId, type StageOutputs, type TraceRow, type Usage } from './api'

export type TraceStatus = TraceRow['status'] | 'skipped'

export interface TraceLine {
  key: string
  index: number
  name: string
  status: TraceStatus
  ms: number
  detail: string
  tokens?: number
  cost?: number
  // Bar length, as a percentage of the slowest call in the run.
  share: number
}

// Where a run ended, when it did not finish.
export type RunEnd = { kind: 'stopped' | 'failed'; stage: StageId } | null

// One line per call, then one "skipped" line per stage that never produced a call or output.
export function buildTrace(calls: CallRecord[], outputs: StageOutputs, end: RunEnd): TraceLine[] {
  const rows: { key: string; row: Omit<TraceRow, 'status'> & { status: TraceStatus } }[] = calls.map((call, i) => ({
    key: `call-${i}`,
    row: call.row,
  }))

  if (end) {
    for (const stage of STAGE_IDS) {
      if (outputs[stage] || calls.some(call => call.stage === stage)) continue
      const stopped = end.kind === 'stopped' && end.stage === stage
      rows.push({
        key: `skip-${stage}`,
        row: {
          name: STAGE_LABELS[stage],
          status: 'skipped',
          ms: 0,
          detail: stopped ? 'Stopped before this stage finished.' : 'Not run yet.',
        },
      })
    }
  }

  const slowest = Math.max(0, ...rows.map(({ row }) => row.ms))
  return rows.map(({ key, row }, i) => ({
    key,
    index: i + 1,
    name: row.name,
    status: row.status,
    ms: row.ms,
    detail: row.detail,
    tokens: row.tokens,
    cost: row.cost,
    share: slowest > 0 ? Math.round((row.ms / slowest) * 100) : 0,
  }))
}

export interface RunTotals {
  calls: number
  ms: number
  usageCalls: number
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  costCalls: number
  cost: number | null
  models: string[]
}

// Totals across every call. A figure is null when no call reported it, never zero.
export function summarize(calls: CallRecord[]): RunTotals {
  const reported = calls.flatMap(call => (call.usage ? [call.usage] : []))
  const costed = reported.filter(usage => usage.cost !== undefined)
  const sum = (pick: (usage: Usage) => number): number | null =>
    reported.length > 0 ? reported.reduce((total, usage) => total + pick(usage), 0) : null

  return {
    calls: calls.length,
    ms: calls.reduce((total, call) => total + call.row.ms, 0),
    usageCalls: reported.length,
    promptTokens: sum(usage => usage.prompt_tokens),
    completionTokens: sum(usage => usage.completion_tokens),
    totalTokens: sum(usage => usage.total_tokens),
    costCalls: costed.length,
    cost: costed.length > 0 ? costed.reduce((total, usage) => total + (usage.cost ?? 0), 0) : null,
    models: [...new Set(calls.flatMap(call => (call.model ? [call.model] : [])))],
  }
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function formatMs(ms: number): string {
  return `${ms.toLocaleString('en-US')} ms`
}

export function formatCount(count: number): string {
  return count.toLocaleString('en-US')
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(5)}`
}
