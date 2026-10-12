import { STAGE_IDS, STAGE_LABELS, wordCount, type CallStage, type ModelCheck, type StageId, type StageOutputs, type Usage } from '../../netlify/shared/contract'
import { parseSourcePack } from '../../netlify/shared/sourcepack'
import type { CallRecord } from './api'

export type TraceStatus = 'ok' | 'failed' | 'skipped' | 'running'

export interface TraceLine {
  key: string
  index: number
  stage: CallStage
  name: string
  status: TraceStatus
  ms: number
  detail: string
  tokens?: number
  cost?: number
  model?: string
  newestModel?: string
  modelCheck?: ModelCheck
  // Earlier attempts of this call whose usage never arrived.
  lostAttempts?: number
  // Bar length, as a percentage of the slowest call in the run.
  share: number
}

// Where a run ended, when it did not finish.
export type RunEnd = { kind: 'stopped' | 'failed'; stage: StageId } | null

interface Row {
  key: string
  stage: CallStage
  name: string
  status: TraceStatus
  ms: number
  detail: string
  tokens?: number
  cost?: number
  model?: string
  newestModel?: string
  modelCheck?: ModelCheck
  lostAttempts?: number
}

// One line per call, then one "skipped" line per stage that never produced a call or output.
export function buildTrace(calls: CallRecord[], outputs: StageOutputs, end: RunEnd): TraceLine[] {
  const rows: Row[] = calls.map((call, i) => ({
    key: `call-${i}`,
    stage: call.stage,
    ...call.row,
    model: call.model ?? undefined,
    newestModel: call.newestModel ?? undefined,
    modelCheck: call.modelCheck ?? undefined,
    lostAttempts: call.lostAttempts,
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

// The worst check first: a mismatch outranks a call that named no model, which outranks an unchecked one.
const CHECK_RANK: Record<ModelCheck, number> = { match: 0, unchecked: 1, 'not-reported': 2, mismatch: 3 }

// The marker after a served id. A reply that named no model gets none.
export const CHECK_LABEL: Record<ModelCheck, string | null> = {
  match: '· newest',
  mismatch: '· not newest',
  unchecked: '· unchecked',
  'not-reported': null,
}

// The full text of a served-model chip. On a mismatch it names the newest model after the served one.
export function modelTitle(served: string | null | undefined, newest: string | null | undefined, check: ModelCheck | null | undefined): string | undefined {
  if (!served) return undefined
  return check === 'mismatch' && newest ? `${served}, newest: ${newest}` : served
}

function worstCheck(checks: ModelCheck[]): ModelCheck | null {
  return checks.reduce<ModelCheck | null>((worst, check) => (worst === null || CHECK_RANK[check] > CHECK_RANK[worst] ? check : worst), null)
}

export interface RunTotals {
  calls: number
  // Calls to a model. The Sources lookup is a call, but it has no tokens or cost to report.
  modelCalls: number
  ms: number
  usageCalls: number
  // Model calls whose token usage never arrived, lost attempts of a retried call included. A total with any
  // of these is "at least" what it shows.
  unreportedCalls: number
  // Model calls with no cost, which is every unreported call plus the replies that carried tokens but no cost.
  uncostedCalls: number
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  costCalls: number
  cost: number | null
  models: string[]
  // The served model of the reply the page shows: the last writing call that finished, else the last one tried.
  replyModel: string | null
  // The worst check across the writing calls, or null when none ran.
  modelCheck: ModelCheck | null
  // The first call whose served model is not the newest, for the title on a mismatch.
  mismatch: CallRecord | null
}

// Totals across every call, including failed calls the provider billed. A figure is
// null when no call reported it, never zero. A call whose usage is unknown (a timeout, a lost connection,
// a stop) adds nothing to a figure and is counted in unreportedCalls instead, so the total reads as partial.
export function summarize(calls: CallRecord[]): RunTotals {
  const reported = calls.flatMap(call => (call.usage ? [call.usage] : []))
  const costed = reported.filter(usage => usage.cost !== undefined)
  const sum = (pick: (usage: Usage) => number): number | null =>
    reported.length > 0 ? reported.reduce((total, usage) => total + pick(usage), 0) : null
  const writing = calls.filter(call => call.stage !== 'sources')
  const lost = writing.reduce((total, call) => total + (call.lostAttempts ?? 0), 0)
  const unreportedCalls = writing.filter(call => !call.usage).length + lost
  // The reply the page shows is a writing step's; the citation check after it does not replace it.
  const steps = writing.filter(call => call.stage !== 'check')
  const reply: CallRecord | undefined = [...steps].reverse().find(call => call.row.status === 'ok') ?? steps[steps.length - 1]

  return {
    calls: calls.length,
    modelCalls: writing.length,
    ms: calls.reduce((total, call) => total + call.row.ms, 0),
    usageCalls: reported.length,
    unreportedCalls,
    uncostedCalls: unreportedCalls + writing.filter(call => call.usage && call.usage.cost === undefined).length,
    promptTokens: sum(usage => usage.prompt_tokens),
    completionTokens: sum(usage => usage.completion_tokens),
    totalTokens: sum(usage => usage.total_tokens),
    costCalls: costed.length,
    cost: costed.length > 0 ? costed.reduce((total, usage) => total + (usage.cost ?? 0), 0) : null,
    models: [...new Set(calls.flatMap(call => (call.model ? [call.model] : [])))],
    replyModel: reply?.model ?? null,
    modelCheck: worstCheck(writing.flatMap(call => (call.modelCheck ? [call.modelCheck] : []))),
    mismatch: writing.find(call => call.modelCheck === 'mismatch') ?? null,
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

// What a partial total says about the calls missing from it.
export function notReportedNote(calls: number): string {
  return `(${calls} ${calls === 1 ? 'call' : 'calls'} not reported)`
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(5)}`
}

export type Phase = 'idle' | 'running' | 'done' | 'failed' | 'stopped'

export interface Lane {
  left: number
  width: number
}

/**
 * Waterfall lanes: every call starts where the one before it ended, on one shared axis. A call in
 * progress gets a short marker at the end; with `liveMs` the axis leaves room for it.
 */
export function lanesFor(lines: ReadonlyArray<Pick<TraceLine, 'ms' | 'status'>>): Array<Lane | null> {
  const spent = lines.reduce((sum, line) => sum + line.ms, 0)
  const axis = Math.max(spent, 1) * (lines.some(line => line.status === 'running') ? 1.15 : 1)
  let at = 0
  return lines.map(line => {
    const left = (at / axis) * 100
    at += line.ms
    if (line.status === 'skipped') return null
    if (line.status === 'running') return { left, width: Math.max(100 - left, 2) * 0.12 }
    return { left, width: Math.max((line.ms / axis) * 100, 0.8) }
  })
}
