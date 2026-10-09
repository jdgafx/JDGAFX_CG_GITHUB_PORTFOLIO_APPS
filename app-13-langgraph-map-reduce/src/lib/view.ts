import type { Frame, RunResult, TraceRow } from '../types/frames'

export type Status = 'idle' | 'running' | 'ok' | 'failed' | 'stopped'
export type Phase = 'idle' | 'running' | 'done' | 'error' | 'stopped'
export type StageName = 'split' | 'reduce' | 'synthesize' | 'check' | 'final'

export interface Branch {
  chunk: number
  status: Status
  attempts: number
  detail: string
}

export interface RunView {
  phase: Phase
  stages: Record<StageName, Status>
  branches: Branch[]
  edges: string[]
  /** Set when the coverage check sent missing chunks back through extract. */
  retryLabel: string | null
  rows: TraceRow[]
  result: RunResult | null
  error: string | null
  live: string
}

export function initialView(): RunView {
  return {
    phase: 'idle',
    stages: { split: 'idle', reduce: 'idle', synthesize: 'idle', check: 'idle', final: 'idle' },
    branches: [],
    edges: [],
    retryLabel: null,
    rows: [],
    result: null,
    error: null,
    live: '',
  }
}

const STAGE_NAMES: ReadonlySet<string> = new Set(['split', 'reduce', 'synthesize', 'check', 'final'])

function upsertBranch(branches: Branch[], chunk: number, patch: Partial<Branch>): Branch[] {
  const found = branches.some((b) => b.chunk === chunk)
  const next = found
    ? branches.map((b) => (b.chunk === chunk ? { ...b, ...patch } : b))
    : [...branches, { chunk, status: 'idle' as Status, attempts: 0, detail: '', ...patch }]
  return next.sort((a, b) => a.chunk - b.chunk)
}

/** Applies one server frame to the view. Pure, so the page and its tests share one reading of the stream. */
export function applyFrame(view: RunView, frame: Frame): RunView {
  switch (frame.type) {
    case 'node_start': {
      if (frame.node === 'extract' && frame.chunk !== undefined) {
        const attempts = (view.branches.find((b) => b.chunk === frame.chunk)?.attempts ?? 0) + 1
        return {
          ...view,
          branches: upsertBranch(view.branches, frame.chunk, { status: 'running', attempts, detail: frame.detail }),
          live: `Extracting ${frame.detail}`,
        }
      }
      if (!STAGE_NAMES.has(frame.node)) return view
      return {
        ...view,
        stages: { ...view.stages, [frame.node]: 'running' },
        live: `${frame.detail}`,
      }
    }
    case 'node_end': {
      const row = frame
      const status: Status = row.status === 'ok' ? 'ok' : 'failed'
      const rows = [...view.rows, row]
      if (row.node === 'extract' && row.chunk !== undefined) {
        return {
          ...view,
          rows,
          branches: upsertBranch(view.branches, row.chunk, { status, detail: row.message ?? row.detail }),
          live: `${row.detail} ${status === 'ok' ? 'finished' : 'did not finish'}`,
        }
      }
      if (!STAGE_NAMES.has(row.node)) return { ...view, rows }
      return {
        ...view,
        rows,
        stages: { ...view.stages, [row.node]: status },
        live: `${row.node} ${status === 'ok' ? 'finished' : 'failed'}`,
      }
    }
    case 'edge': {
      const edges = [...view.edges, frame.label]
      if (frame.from === 'split' && frame.to === 'extract' && frame.count !== undefined) {
        // Every chunk is waiting until the limiter admits it, so the graph shows them all from the split on.
        const waiting = Array.from({ length: frame.count }, (_, i) => i + 1).reduce(
          (list, chunk) => (list.some((b) => b.chunk === chunk) ? list : upsertBranch(list, chunk, {})),
          view.branches,
        )
        return { ...view, edges, branches: waiting, live: frame.label }
      }
      const retry = frame.from === 'check' && frame.to === 'extract' ? frame.label : view.retryLabel
      return { ...view, edges, retryLabel: retry, live: frame.label }
    }
    case 'result': {
      // The streamed states stand: a step the run never reached stays idle, and one still open is closed.
      const stages = { ...view.stages }
      for (const name of Object.keys(stages) as StageName[]) {
        if (stages[name] === 'running') stages[name] = 'stopped'
      }
      const branches = view.branches.map((b) => (b.status === 'running' ? { ...b, status: 'stopped' as Status } : b))
      return { ...view, phase: 'done', stages, branches, result: frame.result, live: 'Run complete' }
    }
    case 'error':
      return failView(view, frame.message)
  }
}

/** Ends the view with a message. Stages still running are marked failed. */
export function failView(view: RunView, message: string): RunView {
  const stages = { ...view.stages }
  for (const name of Object.keys(stages) as StageName[]) {
    if (stages[name] === 'running') stages[name] = 'failed'
  }
  const branches = view.branches.map((b) => (b.status === 'running' || b.status === 'idle' ? { ...b, status: 'failed' as Status } : b))
  return { ...view, phase: 'error', stages, branches, error: message, live: message }
}

/** The stream ended without a result or an error: the run is treated as failed. */
export function endView(view: RunView): RunView {
  if (view.phase !== 'running') return view
  return failView(view, 'The run ended before a result was ready. Please try again.')
}

/** The reader stopped the run. Work in progress is stopped, not failed, and no result is written. */
export function stopView(view: RunView): RunView {
  if (view.phase !== 'running') return view
  const stages = { ...view.stages }
  for (const name of Object.keys(stages) as StageName[]) {
    if (stages[name] === 'running') stages[name] = 'stopped'
  }
  const branches = view.branches.map((b) => (b.status === 'running' || b.status === 'idle' ? { ...b, status: 'stopped' as Status } : b))
  return { ...view, phase: 'stopped', stages, branches, live: 'Run stopped' }
}
