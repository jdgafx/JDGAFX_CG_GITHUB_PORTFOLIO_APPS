import {
  COMPARE_MAX_TOKENS,
  PROMPT_MAX_CHARS,
  SLOTS,
  SYSTEM_MAX_CHARS,
  type BlindCompareResponse,
  type CatalogueResponse,
  type CompareResponse,
  type CompareSummary,
  type Cost,
  type JudgeVerdict,
  type ModelCheck,
  type ModelOption,
  type PanelResult,
  type RatingChange,
  type TraceStep,
  type VoteChoice,
  type Usage,
} from '../../netlify/shared/contract'
import { formatUsd } from './format'

export { DEFAULT_PICKS } from './defaultPicks'

const IDLE_STATUS = 'Ready. Choose Compare models to send the prompt to all three panels.'
const NO_NOTE = 'The judge gave no note for this panel.'
const NOT_NAMED = 'a model not reported'

// voting: a blind run whose answers are shown and whose models are still hidden.
type RunStatus = 'running' | 'voting' | 'done' | 'stopped' | 'error'

export type Mode = 'blind' | 'open'

export type VoteView =
  | { state: 'idle' }
  | { state: 'sending'; choice: VoteChoice }
  | { state: 'failed'; message: string; final: boolean }
  | { state: 'counted'; choice: VoteChoice; changes: RatingChange[] }

export type JudgeView =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'skipped'; reason: string }
  | { state: 'done'; verdict: JudgeVerdict }
  // usage, cost: what the judge's reply was billed, when it replied without a usable verdict. notReported is 1 when
  // the call may have been billed with nothing reported (a stop, a lost connection).
  | { state: 'failed'; step: TraceStep; model: string | null; usage?: Usage; cost?: Cost | null; notReported?: number }

export interface RunView {
  status: RunStatus
  mode: Mode
  // The prompt this run answered, kept for the heading over its answers.
  prompt: string
  // What a blind visitor sees before voting. Null in open mode and once the models are revealed.
  blind: BlindCompareResponse | null
  // The full measured run: at once in open mode, after the vote in blind mode.
  compare: CompareResponse | null
  judge: JudgeView
  error: string | null
  // Why a blind request was shown openly (nothing to vote on, or votes unavailable).
  notice: string | null
  vote: VoteView
  // True for a recorded run played back by the replay. Its run id is a real one, so it must never be voted on.
  replay?: true
}

export function startedRun(mode: Mode, prompt: string): RunView {
  return { status: 'running', mode, prompt, blind: null, compare: null, judge: { state: 'idle' }, error: null, notice: null, vote: { state: 'idle' } }
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

export type Picks = Record<'B' | 'C', string>

export interface CheckMarker {
  label: string
  // A warning look for a mismatch, so the marker is not read as a plain note.
  warn: boolean
  // Added to the served id in the title: the newest id, on a mismatch.
  titleSuffix: string
}

// The marker after a served model. Null when there is nothing to show: no check, or the reply named no model.
export function checkMarker(check: ModelCheck | null | undefined, newest: string | null | undefined): CheckMarker | null {
  switch (check) {
    case 'match':
      return { label: '· newest', warn: false, titleSuffix: '' }
    case 'mismatch':
      return { label: '· not newest', warn: true, titleSuffix: `, newest: ${newest}` }
    case 'unchecked':
      return { label: '· unchecked', warn: false, titleSuffix: '' }
    default:
      return null
  }
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

// The first thing that stops a run, so the disabled button can say what to do next.
export function blockedReason(
  catalogue: CatalogueResponse | null,
  picks: Picks,
  prompt: string,
  system: string = '',
): string | null {
  if (catalogue === null) return 'Wait for the model list to load.'
  if (!listed(catalogue, picks.B) || !listed(catalogue, picks.C)) return 'Choose panel B and C models from the list.'
  if (prompt.trim() === '') return 'Enter a prompt, or choose a sample prompt.'
  if (prompt.length > PROMPT_MAX_CHARS) {
    return `Shorten the prompt to ${PROMPT_MAX_CHARS.toLocaleString('en-US')} characters or fewer.`
  }
  if (system.length > SYSTEM_MAX_CHARS) {
    return `Shorten the system prompt to ${SYSTEM_MAX_CHARS.toLocaleString('en-US')} characters or fewer.`
  }
  return null
}

// The status line's words. Before a run it says what stops Compare, or that it is ready. After an
// error the alert carries the message, so the line does not repeat it.
export function statusText(run: RunView | null, blocked: string | null): string {
  if (!run) return blocked ?? IDLE_STATUS
  if (run.status === 'error') return 'Comparison did not finish.'
  return statusLine(run)
}

// A judge note is shown as written, and a blank one says so instead of leaving a heading with nothing under it.
export function panelNote(note: string | undefined): string {
  return note?.trim() ? note : NO_NOTE
}

export function statusLine(run: RunView | null): string {
  if (!run) return ''
  if (run.status === 'running') return run.compare ? 'Asking the judge for an opinion.' : 'Running the three panels.'
  if (run.status === 'voting' && run.replay) return 'Replay of a recorded run. Voting is off, so the models are not shown.'
  if (run.status === 'voting') return 'Three answers are in. Pick the best one to reveal the models.'
  if (run.status === 'stopped') return 'Stopped.'
  if (run.status === 'error') return run.error ?? 'The comparison failed.'
  const answered = run.compare ? run.compare.panels.filter(p => p.ok).length : 0
  return `Comparison finished. ${answered} of ${SLOTS.length} panels answered.`
}

// The three evidence sentences. Each one is built only from a measured number.
export function verdictSentences(summary: CompareSummary): string[] {
  const { fastest, cheapest, mostOutputTokens } = summary
  return [
    fastest ? `Fastest: ${fastest.model ?? NOT_NAMED} at ${Math.round(fastest.latencyMs)} ms` : 'Fastest: no panel completed',
    cheapest
      ? `Cheapest: ${cheapest.model ?? NOT_NAMED} at ${formatUsd(cheapest.usd)} (${cheapest.source})`
      : 'Cheapest: no panel reported a cost',
    mostOutputTokens
      ? `Most output: ${mostOutputTokens.model ?? NOT_NAMED} with ${mostOutputTokens.tokens} tokens`
      : 'Most output: no panel reported output tokens',
  ]
}

// The run trace: the server's panel and judge steps, plus the states only the browser knows.
export function traceSteps(run: RunView): ViewStep[] {
  // Before the vote the panel and judge steps would name the models, so only the compare call shows.
  if (run.blind && !run.compare) {
    return [
      { name: 'Compare request', status: 'ok', ms: run.blind.totalMs, detail: run.replay ? 'Three answers returned. The other steps are not shown in a replay.' : 'Three answers returned. The steps appear after your vote.', tokens: null, cost: null },
    ]
  }
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
  // Every billed call: the panels, answering or not, and the judge.
  promptTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  // Panels and judge together; null when no call reported a cost.
  totalCost: Cost | null
  // The panels' share of the figures above, and the judge's share.
  panelTokens: number | null
  panelCost: Cost | null
  judgeTokens: number | null
  judgeCost: Cost | null
  // Calls that reported a cost, of the calls that returned any usage or cost.
  costedCalls: number
  billedCalls: number
  // Calls that may have been billed with no usage. The figures above are then a lower bound.
  notReported: number
  judgeModel: string
}

interface Billed {
  usage: Usage
  cost: Cost | null
}

// The judge's billed usage, wherever the view keeps it: on its verdict, or on its failure.
function judgeBilled(judge: JudgeView): { billed: Billed | null; notReported: number } {
  if (judge.state === 'done') return { billed: judge.verdict, notReported: judge.verdict.notReported ?? 0 }
  if (judge.state === 'failed') {
    return { billed: judge.usage ? { usage: judge.usage, cost: judge.cost ?? null } : null, notReported: judge.notReported ?? 0 }
  }
  return { billed: null, notReported: 0 }
}

function sumCosts(costs: Array<Cost | null>): Cost | null {
  const reported = costs.filter((c): c is Cost => c !== null)
  if (reported.length === 0) return null
  return { usd: reported.reduce((sum, c) => sum + c.usd, 0), source: reported.some(c => c.source === 'estimated') ? 'estimated' : 'usage' }
}

// Totals cover every call that was billed: all three panels (a cut-off or empty one still cost money), and the judge
// whether or not it gave a verdict. A call with no reported usage is counted in notReported, not left out silently.
export function runTotals(run: RunView): RunTotals {
  const compare = run.compare
  const panels: Billed[] = compare ? compare.panels : []
  const judge = judgeBilled(run.judge)
  const judged: Billed[] = judge.billed ? [judge.billed] : []
  const calls = [...panels, ...judged]
  const judgeDone = run.judge.state !== 'running'
  return {
    runMs: compare && judgeDone ? compare.totalMs + (judgeMs(run.judge) ?? 0) : null,
    answering: compare ? compare.panels.filter(p => p.ok).length : 0,
    promptTokens: sumOf(calls, u => u.prompt_tokens),
    outputTokens: sumOf(calls, u => u.completion_tokens),
    totalTokens: sumOf(calls, u => u.total_tokens),
    totalCost: sumCosts(calls.map(c => c.cost)),
    panelTokens: sumOf(panels, u => u.total_tokens),
    panelCost: sumCosts(panels.map(c => c.cost)),
    judgeTokens: sumOf(judged, u => u.total_tokens),
    judgeCost: judge.billed?.cost ?? null,
    costedCalls: calls.filter(c => c.cost !== null).length,
    billedCalls: calls.filter(c => c.cost !== null || c.usage.total_tokens !== null).length,
    notReported: (compare ? compare.panels.reduce((sum, p) => sum + (p.notReported ?? 0), 0) : 0) + judge.notReported,
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

function sumOf(calls: Billed[], field: (usage: Usage) => number | null): number | null {
  const values = calls.map(c => field(c.usage)).filter((v): v is number => v !== null)
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0)
}
