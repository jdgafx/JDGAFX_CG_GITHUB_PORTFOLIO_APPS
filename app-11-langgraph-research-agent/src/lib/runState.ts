import type {
  CheckpointOffer,
  CostSource,
  Frame,
  FrameUsage,
  NodeEndFrame,
  NodeName,
  NodeStatus,
  ResultFrame,
} from '../../netlify/shared/events'

export const NODES: NodeName[] = ['plan', 'agent', 'tools', 'draft', 'critic', 'final']

export type Phase = 'idle' | 'running' | 'done' | 'failed' | 'stopped'

/** How the graph view draws a node. */
export type NodeMark = 'idle' | 'active' | 'ok' | 'failed' | 'skipped' | 'stopped' | 'reused' | 'edited'

/** One row of the run trace: a node visit that is running, stopped, or finished. */
export interface TraceEntry {
  key: string
  node: NodeName
  visit: number
  status: NodeStatus | 'running' | 'stopped'
  ms?: number
  detail: string
  model?: string
  servedModel?: string | null
  usage?: FrameUsage
  cost?: number
  costSource?: CostSource
  /** A step a resumed run did not run again. Its time and cost are the original run's. */
  reused?: boolean
  /** A step the visitor's edit stands in for. */
  edited?: boolean
}

export interface RunView {
  phase: Phase
  active: NodeName | null
  marks: Record<NodeName, NodeMark>
  /** The latest label taken on each conditional edge, keyed "from>to". */
  taken: Record<string, string>
  trace: TraceEntry[]
  result: ResultFrame | null
  error: string | null
  /** The id the server gave this run, for a report to quote. */
  runId: string | null
  /** The points a finished fresh run offers to rewind to. */
  checkpoints: CheckpointOffer[]
  /** Client clock, Date.now(): when the run started and when it failed or was stopped. */
  startedAt: number | null
  endedAt: number | null
  /** Client clock when the first live Wikipedia page of this run arrived. Null until a page was read. */
  liveAt: number | null
}

/** How the server words a tools step that read at least one page (nodes.ts toolsStep). */
export const NEW_SOURCES = 'New sources:'

const keyOf = (node: NodeName, visit: number) => `${node}-${visit}`

const idleMarks = (): Record<NodeName, NodeMark> => ({
  plan: 'idle',
  agent: 'idle',
  tools: 'idle',
  draft: 'idle',
  critic: 'idle',
  final: 'idle',
})

export function emptyRun(): RunView {
  return { phase: 'idle', active: null, marks: idleMarks(), taken: {}, trace: [], result: null, error: null, runId: null, checkpoints: [], startedAt: null, endedAt: null, liveAt: null }
}

export function startRun(): RunView {
  return { ...emptyRun(), phase: 'running', startedAt: Date.now() }
}

function entryFor(frame: NodeEndFrame): TraceEntry {
  const { node, visit, status, ms, detail, model, servedModel, usage, cost, costSource, reused, edited } = frame
  return { key: keyOf(node, visit), node, visit, status, ms, detail, model, servedModel, usage, cost, costSource, reused, edited }
}

function withEntry(trace: TraceEntry[], entry: TraceEntry): TraceEntry[] {
  const index = trace.findIndex((item) => item.key === entry.key)
  if (index === -1) return [...trace, entry]
  return trace.map((item, i) => (i === index ? entry : item))
}

/** Ends every visit still running, so no row keeps saying "running" once the run is over. */
function closeRunning(trace: TraceEntry[], status: 'failed' | 'stopped', detail: string): TraceEntry[] {
  return trace.map((entry): TraceEntry => (entry.status === 'running' ? { ...entry, status, detail } : entry))
}

/** Folds one frame into the run view. Pure, so the page and the tests share it. */
export function applyFrame(view: RunView, frame: Frame): RunView {
  switch (frame.type) {
    case 'run_start':
      return { ...view, runId: frame.runId }
    case 'node_start': {
      const running: TraceEntry = {
        key: keyOf(frame.node, frame.visit),
        node: frame.node,
        visit: frame.visit,
        status: 'running',
        detail: 'Running.',
      }
      return {
        ...view,
        active: frame.node,
        marks: { ...view.marks, [frame.node]: 'active' },
        trace: withEntry(view.trace, running),
      }
    }
    case 'node_end': {
      const entry = entryFor(frame)
      // The tools step names the pages it read. A kept (reused) row was read in the original run, not now.
      const readPage = frame.node === 'tools' && !frame.reused && frame.status === 'ok' && frame.detail.startsWith(NEW_SOURCES)
      // A reused or edited step shows its own mark, so the graph tells the kept steps from the ones that ran again.
      const mark: NodeMark = frame.reused ? 'reused' : frame.edited ? 'edited' : frame.status
      return {
        ...view,
        active: null,
        marks: { ...view.marks, [frame.node]: mark },
        trace: withEntry(view.trace, entry),
        liveAt: view.liveAt ?? (readPage ? Date.now() : null),
      }
    }
    case 'edge':
      return { ...view, taken: { ...view.taken, [`${frame.from}>${frame.to}`]: frame.label } }
    case 'result':
      return { ...view, phase: 'done', active: null, result: frame, error: null }
    case 'checkpoints':
      return { ...view, checkpoints: frame.items }
    case 'error':
      // A visit still running when the error arrives will never finish, so it is shown as failed.
      return failRun(view, frame.message)
  }
}

/** The visitor stopped the run. The step in progress is marked stopped, and no row keeps running. */
export function stopRun(view: RunView): RunView {
  return {
    ...view,
    phase: 'stopped',
    active: null,
    marks: view.active ? { ...view.marks, [view.active]: 'stopped' } : view.marks,
    trace: closeRunning(view.trace, 'stopped', 'Stopped before this step finished.'),
    error: null,
    endedAt: Date.now(),
  }
}

/** The answer stream broke, or the server refused the run. The step in progress is marked failed. */
export function failRun(view: RunView, message: string): RunView {
  return {
    ...view,
    phase: 'failed',
    active: null,
    marks: view.active ? { ...view.marks, [view.active]: 'failed' } : view.marks,
    trace: closeRunning(view.trace, 'failed', message),
    error: message,
    endedAt: Date.now(),
  }
}

/** The word for the header badge. */
export function statusText(view: RunView): string {
  if (view.phase === 'done' && view.result?.fork) {
    const { ending, critic } = view.result
    if (ending.kind !== 'complete') return 'Partial new answer'
    return critic.reviewed && critic.verdict === 'accept' ? 'New answer ready' : 'New answer, critic not satisfied'
  }
  if (view.phase === 'running') {
    if (view.active) return `Running: ${view.active}`
    return view.trace.length === 0 ? 'Starting the run' : 'Running'
  }
  if (view.phase === 'done') {
    if (view.result?.ending.kind === 'partial') return 'Partial answer'
    return view.result?.ending.kind === 'no_answer' ? 'No answer' : 'Answer ready'
  }
  if (view.phase === 'failed') return 'Failed'
  if (view.phase === 'stopped') return 'Stopped'
  return 'Ready'
}

/** The status line under the controls. It uses the button's verb, so the page says what it is doing. */
/** True when the view is a resumed run: it has kept or edited steps, or its result says it was resumed. */
const isResumed = (view: RunView) => view.result?.fork !== undefined || view.trace.some((entry) => entry.reused || entry.edited)

export function researchStatus(view: RunView): string {
  if (isResumed(view)) {
    if (view.phase === 'running') return view.active ? `Re-run in progress. Current step: ${view.active}.` : 'Re-run in progress.'
    if (view.phase === 'done') {
      const { ending } = view.result ?? { ending: { kind: 'complete' } }
      return ending.kind === 'complete'
        ? 'Re-run finished. The new answer is beside the original.'
        : 'Re-run stopped early. The new answer is the last draft, labelled below.'
    }
    if (view.phase === 'failed') return 'Re-run failed. The original run is still here: edit and re-run, or go back to it.'
    if (view.phase === 'stopped') return 'Re-run stopped. Steps that finished are still in the trace.'
  }
  if (view.phase === 'running') {
    if (view.active) return `Research running. Current step: ${view.active}.`
    return view.trace.length === 0 ? 'Starting research.' : 'Research running.'
  }
  if (view.phase === 'done') {
    const { ending, sources } = view.result ?? { ending: { kind: 'complete' }, sources: [] }
    if (ending.kind === 'no_answer') return 'Research stopped early. No answer was written. The pages read are listed.'
    if (ending.kind === 'partial') return 'Research stopped early. The answer is the last draft, labelled below.'
    return sources.length === 0 ? 'Research finished. The answer cites no source.' : 'Research finished. The cited answer is ready.'
  }
  if (view.phase === 'failed') return 'Research failed. The answer panel says why.'
  if (view.phase === 'stopped') return 'Research stopped. Steps that finished are still in the trace.'
  return 'Ready. Start research when the question is set.'
}

export type LiveState = 'idle' | 'live' | 'failed'

/**
 * The live-data indicator. It lights only once a Wikipedia page was really read, so it never claims data the run did
 * not fetch. It reads failed when the tools ran and none of them returned a page. `earlier` is the original run's
 * time, used while a re-run shows pages that were read earlier and fetches none of its own.
 */
export function liveData(view: RunView, earlier: number | null = null): { state: LiveState; at: number | null } {
  if (view.liveAt !== null) return { state: 'live', at: view.liveAt }
  const ended = view.phase === 'done' || view.phase === 'failed' || view.phase === 'stopped'
  const toolsRan = view.trace.some((entry) => entry.node === 'tools' && !entry.reused && entry.status !== 'running')
  // A re-run that fetched for itself and got no page is a failed fetch, whatever the original run read.
  if (ended && toolsRan) return { state: 'failed', at: null }
  if (earlier !== null) return { state: 'live', at: earlier }
  return { state: 'idle', at: null }
}
