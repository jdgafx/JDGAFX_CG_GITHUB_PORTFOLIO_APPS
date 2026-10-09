// Step trace for one run. Each stage is timed on the server with Date.now().
// A step's time runs from the end of the previous step, so the steps add up
// to the run's total. The exception is a step given its own `ms`: tool calls run
// in parallel and are timed one by one, so their times can overlap.

type StepStatus = 'ok' | 'failed' | 'skipped'

interface TraceStep {
  name: string
  status: StepStatus
  ms: number
  detail: string
  tokens?: number
  cost?: number
  // A tool call, e.g. weather("Lisbon"), and the page or request its data came from.
  call?: string
  source?: string
}

// Extra fields a step may carry. `ms` replaces the time since the previous step, for
// steps that ran in parallel and were timed on their own.
interface StepExtras {
  tokens?: number
  cost?: number
  call?: string
  source?: string
  ms?: number
}

export interface Recorder {
  readonly steps: TraceStep[]
  add: (name: string, status: StepStatus, detail: string, extras?: StepExtras) => void
  elapsed: () => number
}

export function createRecorder(): Recorder {
  const startedAt = Date.now()
  const steps: TraceStep[] = []
  let mark = startedAt
  return {
    steps,
    add(name, status, detail, { ms, ...extras } = {}) {
      const now = Date.now()
      steps.push({ name, status, ms: ms ?? now - mark, detail, ...extras })
      mark = now
    },
    elapsed: () => Date.now() - startedAt,
  }
}
