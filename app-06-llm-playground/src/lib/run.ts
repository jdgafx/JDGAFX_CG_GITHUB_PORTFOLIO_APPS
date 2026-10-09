import {
  COMPARE_MAX_TOKENS,
  SLOTS,
  type CatalogueResponse,
  type CompareResponse,
  type CompareSummary,
  type Cost,
  type JudgeVerdict,
  type ModelOption,
  type PanelResult,
  type TraceStep,
  type Usage,
} from '../../netlify/shared/contract'
import { formatUsd } from './format'

type RunStatus = 'running' | 'done' | 'stopped' | 'error'

export type JudgeView =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'skipped'; reason: string }
  | { state: 'done'; verdict: JudgeVerdict }
  | { state: 'failed'; step: TraceStep; model: string | null }

export interface RunView {
  status: RunStatus
  compare: CompareResponse | null
  judge: JudgeView
  error: string | null
}

// The server reports ok, failed or skipped. The browser adds "running" for a step in progress.
export type StepStatus = TraceStep['status'] | 'running'

interface ViewStep extends Omit<TraceStep, 'status'> {
  status: StepStatus
}

// The panel's state word, with the dot class that matches it, so colour is never the only signal.
export function panelStatus(panel: PanelResult): { label: string; dot: string } {
  if (!panel.ok) return { label: 'Failed', dot: 'ds-dot--failed' }
  if (panel.finishReason === 'length') return { label: `Capped at ${COMPARE_MAX_TOKENS} tokens`, dot: 'arena-dot--warn' }
  return { label: 'Complete', dot: 'ds-dot--ok' }
}

// The picker's starting models for panels B and C. Both must be curated IDs (see curated.ts).
export const DEFAULT_PICKS: Record<'B' | 'C', string> = {
  B: 'google/gemini-2.5-flash-lite',
  C: 'anthropic/claude-sonnet-5',
}

function allOptions(catalogue: CatalogueResponse): ModelOption[] {
  return catalogue.groups.flatMap(group => group.options)
}

// True when the loaded model list offers this ID. A run never starts with a pick that fails this.
export function listed(catalogue: CatalogueResponse, id: string): boolean {
  return allOptions(catalogue).some(option => option.id === id)
}

// Keeps the current pick when the list still offers it, otherwise takes the first option.
export function chooseOption(catalogue: CatalogueResponse, current: string): string {
  if (listed(catalogue, current)) return current
  return allOptions(catalogue)[0]?.id ?? current
}

export function statusLine(run: RunView | null): string {
  if (!run) return ''
  if (run.status === 'running') return run.compare ? 'Asking the judge for an opinion.' : 'Running the three panels.'
  if (run.status === 'stopped') return 'Stopped.'
  if (run.status === 'error') return run.error ?? 'The comparison failed.'
  const answered = run.compare ? run.compare.panels.filter(p => p.ok).length : 0
  return `Comparison finished. ${answered} of ${SLOTS.length} panels answered.`
}

// The three evidence sentences. Each one is built only from a measured number.
export function verdictSentences(summary: CompareSummary): string[] {
  const { fastest, cheapest, mostOutputTokens } = summary
  return [
    fastest ? `Fastest: ${fastest.model} at ${Math.round(fastest.latencyMs)} ms` : 'Fastest: no panel completed',
    cheapest
      ? `Cheapest: ${cheapest.model} at ${formatUsd(cheapest.usd)} (${cheapest.source})`
      : 'Cheapest: no panel reported a cost',
    mostOutputTokens
      ? `Most output: ${mostOutputTokens.model} with ${mostOutputTokens.tokens} tokens`
      : 'Most output: no panel reported output tokens',
  ]
}

// The run trace: the server's panel and judge steps, plus the states only the browser knows.
export function traceSteps(run: RunView): ViewStep[] {
  if (!run.compare) {
    if (run.error) return [failedStep('Compare request', run.error)]
    if (run.status === 'stopped') return [failedStep('Compare request', 'Stopped before the panels answered')]
    return [{ name: 'Compare request', status: 'running', ms: null, detail: 'Waiting for the three panels', tokens: null, cost: null }]
  }
  return [...run.compare.trace, judgeViewStep(run.judge)]
}

// A judge step the browser made itself, for a stop or a network failure.
export function failedJudgeStep(reason: string): TraceStep {
  return failedStep('Judge', reason)
}

function failedStep(name: string, detail: string): TraceStep {
  return { name, status: 'failed', ms: null, detail, tokens: null, cost: null }
}

function judgeViewStep(judge: JudgeView): ViewStep {
  switch (judge.state) {
    case 'done':
      return judge.verdict.trace[0]
    case 'failed':
      return judge.step
    case 'running':
      return { name: 'Judge', status: 'running', ms: null, detail: 'Reading the answers', tokens: null, cost: null }
    case 'skipped':
      return { name: 'Judge', status: 'skipped', ms: null, detail: judge.reason, tokens: null, cost: null }
    default:
      return { name: 'Judge', status: 'skipped', ms: null, detail: 'Not started', tokens: null, cost: null }
  }
}

export interface RunTotals {
  runMs: number | null
  answering: number
  promptTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  panelCost: Cost | null
  costedPanels: number
  judgeModel: string
}

// Totals cover the answering panels only, which is what the spec's cost sum allows.
export function runTotals(run: RunView): RunTotals {
  const compare = run.compare
  const answering = compare ? compare.panels.filter(p => p.ok) : []
  const costs = answering.map(p => p.cost).filter((c): c is Cost => c !== null)
  const judgeDone = run.judge.state !== 'running'
  return {
    runMs: compare && judgeDone ? compare.totalMs + (judgeMs(run.judge) ?? 0) : null,
    answering: answering.length,
    promptTokens: sumOf(answering, u => u.prompt_tokens),
    outputTokens: sumOf(answering, u => u.completion_tokens),
    totalTokens: sumOf(answering, u => u.total_tokens),
    panelCost:
      costs.length === 0
        ? null
        : {
            usd: costs.reduce((sum, c) => sum + c.usd, 0),
            source: costs.some(c => c.source === 'estimated') ? 'estimated' : 'usage',
          },
    costedPanels: costs.length,
    judgeModel: judgeModelLabel(run.judge),
  }
}

function judgeMs(judge: JudgeView): number | null {
  if (judge.state === 'done') return judge.verdict.latencyMs
  if (judge.state === 'failed') return judge.step.ms
  return null
}

function judgeModelLabel(judge: JudgeView): string {
  if (judge.state === 'done') return judge.verdict.model ?? 'not reported'
  if (judge.state === 'failed') return judge.model ?? 'not reported'
  if (judge.state === 'running') return 'running'
  return 'not run'
}

function sumOf(panels: PanelResult[], field: (usage: Usage) => number | null): number | null {
  const values = panels.map(p => field(p.usage)).filter((v): v is number => v !== null)
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0)
}
