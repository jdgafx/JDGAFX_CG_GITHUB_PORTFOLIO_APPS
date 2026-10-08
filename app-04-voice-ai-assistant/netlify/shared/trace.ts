// Step trace for one run. Each stage is timed on the server with Date.now().
// A step's time runs from the end of the previous step, so the steps add up
// to the run's total.

type StepStatus = 'ok' | 'failed' | 'skipped'

interface TraceStep {
  name: string
  status: StepStatus
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

export interface Recorder {
  readonly steps: TraceStep[]
  add: (name: string, status: StepStatus, detail: string, usage?: { tokens?: number; cost?: number }) => void
  elapsed: () => number
}

export function createRecorder(): Recorder {
  const startedAt = Date.now()
  const steps: TraceStep[] = []
  let mark = startedAt
  return {
    steps,
    add(name, status, detail, usage = {}) {
      const now = Date.now()
      steps.push({ name, status, ms: now - mark, detail, ...usage })
      mark = now
    },
    elapsed: () => Date.now() - startedAt,
  }
}
