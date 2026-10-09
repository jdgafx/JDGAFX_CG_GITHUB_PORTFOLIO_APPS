import type {
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
export type NodeMark = 'idle' | 'active' | 'ok' | 'failed' | 'skipped' | 'stopped'

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
}

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
  return { phase: 'idle', active: null, marks: idleMarks(), taken: {}, trace: [], result: null, error: null }
}

export function startRun(): RunView {
  return { ...emptyRun(), phase: 'running' }
}

function entryFor(frame: NodeEndFrame): TraceEntry {
  const { node, visit, status, ms, detail, model, servedModel, usage, cost, costSource } = frame
  return { key: keyOf(node, visit), node, visit, status, ms, detail, model, servedModel, usage, cost, costSource }
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
      return {
        ...view,
        active: null,
        marks: { ...view.marks, [frame.node]: frame.status },
        trace: withEntry(view.trace, entry),
      }
    }
    case 'edge':
      return { ...view, taken: { ...view.taken, [`${frame.from}>${frame.to}`]: frame.label } }
    case 'result':
      return { ...view, phase: 'done', active: null, result: frame, error: null }
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
  }
}

/** The word for the header badge. */
export function statusText(view: RunView): string {
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
export function researchStatus(view: RunView): string {
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
  if (view.phase === 'failed') return 'Research failed. The message above says why.'
  if (view.phase === 'stopped') return 'Research stopped. Steps that finished are still in the trace.'
  return 'Ready. Start research when the question is set.'
}
