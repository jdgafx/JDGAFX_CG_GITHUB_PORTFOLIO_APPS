import { formatTokens, formatCount } from './format'
import { MAX_CHARS, MIN_CHARS } from './limits'
import type { Phase, RunView, StageName, Status } from './view'

/** The word beside a graph node's dot. */
export const STATE_WORD: Record<Status, string> = {
  idle: 'Waiting',
  running: 'Running',
  ok: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
}

/** A step that never started reads Not run once the run is over, instead of Waiting. */
export function stageWord(status: Status, ended: boolean): string {
  return status === 'idle' && ended ? 'Not run' : STATE_WORD[status]
}

/** The header badge word for each phase. The primary button uses the same verb. */
export const PHASE_WORD: Record<Phase, string> = {
  idle: 'Ready',
  running: 'Analyzing',
  done: 'Finished',
  error: 'Failed',
  stopped: 'Stopped',
}

/** The dot beside the header badge. The word always carries the state too. */
export function phaseDot(phase: Phase): string {
  if (phase === 'running') return 'ds-dot ds-dot--running'
  if (phase === 'done') return 'ds-dot ds-dot--ok'
  if (phase === 'error') return 'ds-dot ds-dot--failed'
  if (phase === 'stopped') return 'ds-dot ds-dot--stopped'
  return 'ds-dot'
}

export function phaseTone(phase: Phase): string {
  if (phase === 'running') return 'ds-badge--accent'
  if (phase === 'done') return 'ds-badge--success'
  if (phase === 'error') return 'ds-badge--danger'
  if (phase === 'stopped') return 'ds-badge--warning'
  return ''
}

/** Capitalises the first letter, so the server's short labels read as sentences. */
export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** True once any frame has arrived, so "Starting the run." is only ever shown before the first one. */
function hasStarted(view: RunView): boolean {
  return Object.values(view.stages).some((s) => s !== 'idle') || view.branches.some((b) => b.status !== 'idle')
}

/** What the run is doing right now, or an empty string in the gap between two steps. */
export function runningStep(view: RunView): string {
  if (view.stages.split === 'running') return 'Splitting the text into chunks.'
  const retried = view.branches.filter((b) => b.status === 'running' && b.attempts > 1).length
  if (retried > 0) return `Retrying ${formatCount(retried, 'missing chunk')}.`
  if (view.branches.some((b) => b.status === 'running')) {
    const done = view.branches.filter((b) => b.status === 'ok').length
    return `${done} of ${formatCount(view.branches.length, 'chunk')} extracted.`
  }
  if (view.stages.reduce === 'running') return 'Merging the findings.'
  if (view.stages.synthesize === 'running') return 'Writing the cited summary.'
  if (view.stages.check === 'running') return 'Checking coverage.'
  if (view.stages.final === 'running') return 'Finishing the run.'
  return hasStarted(view) ? '' : 'Starting the run.'
}

/** The status line: the phase's verb, then what the run is doing or what it ended with. */
export function statusLine(view: RunView, length: number, valid: boolean): string {
  switch (view.phase) {
    case 'running':
      return `Analyzing. ${runningStep(view) || view.lastStep}`.trim()
    case 'done': {
      const { covered, missing } = view.result?.coverage ?? { covered: [], missing: [] }
      return `Finished. ${covered.length} of ${formatCount(covered.length + missing.length, 'chunk')} covered.`
    }
    case 'error':
      return 'Failed. See the message above the readout, then try again.'
    case 'stopped':
      return 'Stopped. No summary was written. Analyze again to start over.'
    case 'idle':
      return valid
        ? `Ready to analyze ${formatTokens(length)} characters.`
        : `Paste ${formatTokens(MIN_CHARS)} to ${formatTokens(MAX_CHARS)} characters, or load a Wikipedia article.`
  }
}

/** The label on the fan's entry: how many chunks the split produced, or what the fan will do. */
export function fanText(view: RunView): string {
  return view.branches.length > 0 ? `Fan out to ${formatCount(view.branches.length, 'chunk')}` : 'One extract call per chunk'
}

/** The label on the loop: the retry if one ran, otherwise the reason the run left the check. */
export function loopText(view: RunView): string {
  if (view.retryLabel) return sentence(view.retryLabel)
  const exit = view.edges.find((e) => e.startsWith('coverage') || e.includes('still missing'))
  if (exit) return sentence(exit)
  return 'Retry if chunks are missing'
}

/** The short label on the loop in the drawing. The full reason stays in the coverage notice. */
export function loopShort(view: RunView): string {
  if (view.retryLabel) return sentence(view.retryLabel)
  return view.edges.some((e) => e.startsWith('coverage')) ? 'Coverage complete' : 'Retry if chunks are missing'
}

/** The steps taken so far, in order, for the path line. Repeated extract rows collapse to "extract, 9 chunks". */
export function pathSteps(view: RunView): Array<{ label: string; now: boolean }> {
  const steps: Array<{ label: string; now: boolean; extracts: number }> = []
  for (const row of view.rows) {
    const last = steps[steps.length - 1]
    if (row.node === 'extract' && last && last.extracts > 0) {
      last.extracts += 1
      last.label = `extract, ${formatCount(last.extracts, 'chunk')}`
    } else if (row.node === 'extract') {
      steps.push({ label: 'extract, 1 chunk', now: false, extracts: 1 })
    } else steps.push({ label: row.node, now: false, extracts: 0 })
  }
  const running = (Object.keys(view.stages) as StageName[]).find((name) => view.stages[name] === 'running')
  if (running) steps.push({ label: running, now: true, extracts: 0 })
  else if (view.branches.some((b) => b.status === 'running')) {
    const last = steps[steps.length - 1]
    if (last && last.extracts > 0) last.now = true
    else steps.push({ label: 'extract', now: true, extracts: 0 })
  }
  return steps.map(({ label, now }) => ({ label, now }))
}
