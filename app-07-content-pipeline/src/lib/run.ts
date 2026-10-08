import { STAGE_IDS, STAGE_LABELS, type CallRecord, type StageId, type StageOutputs, type TraceRow, type Usage } from './api'

export type TraceStatus = TraceRow['status'] | 'skipped' | 'running'

export interface TraceLine {
  key: string
  index: number
  name: string
  status: TraceStatus
  ms: number
  detail: string
  tokens?: number
  cost?: number
  model?: string
  // Bar length, as a percentage of the slowest call in the run.
  share: number
}

// Where a run ended, when it did not finish.
export type RunEnd = { kind: 'stopped' | 'failed'; stage: StageId } | null

interface Row {
  key: string
  name: string
  status: TraceStatus
  ms: number
  detail: string
  tokens?: number
  cost?: number
  model?: string
}

// One line per call, then one "skipped" line per stage that never produced a call or output.
export function buildTrace(calls: CallRecord[], outputs: StageOutputs, end: RunEnd): TraceLine[] {
  const rows: Row[] = calls.map((call, i) => ({
    key: `call-${i}`,
    ...call.row,
    model: call.model ?? undefined,
  }))

  if (end) {
    for (const stage of STAGE_IDS) {
      if (outputs[stage] || calls.some(call => call.stage === stage)) continue
      const stopped = end.kind === 'stopped' && end.stage === stage
      rows.push({
        key: `skip-${stage}`,
        name: STAGE_LABELS[stage],
        status: 'skipped',
        ms: 0,
        detail: stopped ? 'Stopped before this stage finished.' : 'Not run yet.',
      })
    }
  }

  const slowest = Math.max(0, ...rows.map(row => row.ms))
  return rows.map((row, i) => ({
    ...row,
    index: i + 1,
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

// Totals across every call, including failed calls the provider billed. A figure is
// null when no call reported it, never zero.
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

// The key a run is saved under. A resumed run reuses finished stages only under the same key.
export function runKeyFor(topic: string, contentType: string): string {
  return `${topic}\n${contentType}`
}

export function keepsFinishedStages(previousKey: string, runKey: string, resume: boolean): boolean {
  return resume && previousKey === runKey
}

export type StageState = 'waiting' | 'running' | 'done' | 'failed' | 'skipped'

export interface StageView {
  stage: StageId
  state: StageState
  words: number
}

// The state of each stage on the pipeline. Once a run has ended, every stage it did not reach is
// skipped, the same way the trace marks it, so the pipeline and the trace always agree.
export function stageViews(outputs: StageOutputs, runningStage: StageId | null, end: RunEnd): StageView[] {
  return STAGE_IDS.map((stage): StageView => {
    const text = outputs[stage]
    if (text !== undefined) return { stage, state: 'done', words: wordCount(text) }
    if (stage === runningStage) return { stage, state: 'running', words: 0 }
    if (end && end.stage === stage) return { stage, state: end.kind === 'failed' ? 'failed' : 'skipped', words: 0 }
    return { stage, state: end ? 'skipped' : 'waiting', words: 0 }
  })
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
