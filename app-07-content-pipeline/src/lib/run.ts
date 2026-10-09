import { STAGE_IDS, STAGE_LABELS, wordCount, type StageId, type StageOutputs, type Usage } from '../../netlify/shared/contract'
import { parseSourcePack } from '../../netlify/shared/sourcepack'
import type { CallRecord } from './api'

export type TraceStatus = 'ok' | 'failed' | 'skipped' | 'running'

export interface TraceLine {
  key: string
  index: number
  stage: StageId
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
  stage: StageId
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
    stage: call.stage,
    ...call.row,
    model: call.model ?? undefined,
  }))

  if (end) {
    for (const stage of STAGE_IDS) {
      if (outputs[stage] || calls.some(call => call.stage === stage)) continue
      const stopped = end.kind === 'stopped' && end.stage === stage
      rows.push({
        key: `skip-${stage}`,
        stage,
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
  // Calls to a model. The Sources lookup is a call, but it has no tokens or cost to report.
  modelCalls: number
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
    modelCalls: calls.filter(call => call.stage !== 'sources').length,
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

export type StageState = 'waiting' | 'running' | 'done' | 'failed' | 'skipped'

export interface StageView {
  stage: StageId
  state: StageState
  // Words written, or for the Sources stage the number of sources found.
  amount: number
  unit: 'words' | 'sources'
}

// The state of each stage on the pipeline. Once a run has ended, every stage it did not reach is
// skipped, the same way the trace marks it, so the pipeline and the trace always agree.
export function stageViews(outputs: StageOutputs, runningStage: StageId | null, end: RunEnd): StageView[] {
  return STAGE_IDS.map((stage): StageView => {
    const unit = stage === 'sources' ? 'sources' : 'words'
    const text = outputs[stage]
    const view = (state: StageState, amount = 0): StageView => ({ stage, state, amount, unit })
    if (text !== undefined) return view('done', unit === 'sources' ? parseSourcePack(text).sources.length : wordCount(text))
    if (stage === runningStage) return view('running')
    if (end && end.stage === stage) return view(end.kind === 'failed' ? 'failed' : 'skipped')
    return view(end ? 'skipped' : 'waiting')
  })
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
