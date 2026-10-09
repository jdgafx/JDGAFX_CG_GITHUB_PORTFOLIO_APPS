// The steps of one run, reported as each changes so the trace updates live.
// Running steps are timed from the moment they were first reported.

export const STEP_STATUSES = ['running', 'ok', 'failed', 'skipped', 'stopped'] as const
export type StepStatus = (typeof STEP_STATUSES)[number]

export interface TraceStep {
  name: string
  status: StepStatus
  ms?: number
  detail: string
  tokens?: number
  cost?: number
}

// Replaces the step with the same name, or appends it. Used for the live trace and the history view alike.
export function upsertStep(steps: TraceStep[], step: TraceStep): TraceStep[] {
  const index = steps.findIndex(existing => existing.name === step.name)
  if (index === -1) return [...steps, step]
  const next = steps.slice()
  next[index] = step
  return next
}

export interface Trace {
  steps: TraceStep[]
  readonly startedAt: number
  readonly since: Map<string, number>
  readonly onStep: (step: TraceStep) => void
}

export function newTrace(onStep: (step: TraceStep) => void): Trace {
  return { steps: [], startedAt: Date.now(), since: new Map(), onStep }
}

export function record(trace: Trace, step: TraceStep): void {
  if (step.status === 'running') trace.since.set(step.name, Date.now())
  trace.steps = upsertStep(trace.steps, step)
  trace.onStep(step)
}

export function elapsed(trace: Trace, name: string): number {
  return Date.now() - (trace.since.get(name) ?? trace.startedAt)
}

// Ends every step still running, so a stopped run never shows a step in progress.
export function settle(trace: Trace, detail: string, status: StepStatus = 'failed'): void {
  for (const step of trace.steps.filter(s => s.status === 'running')) {
    record(trace, { name: step.name, status, ms: elapsed(trace, step.name), detail })
  }
}

export function activeName(trace: Trace): string {
  return trace.steps.find(step => step.status === 'running')?.name ?? 'Request checked'
}
