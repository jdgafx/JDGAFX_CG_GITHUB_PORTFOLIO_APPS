import type { StepStatus, TraceStep, Usage } from '../../src/types'

const USAGE_FIELDS = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const

/** Every stage a run passes, in order. A run that stops early lists the stages it never reached as skipped. */
export const PIPELINE = [
  'Check request',
  'Build prompt',
  'Pass 1: review',
  'Parse reply',
  'Checks',
  'Pass 2: verify (read 1)',
  'Pass 2: verify (read 2, adversary)',
  'Re-validate',
] as const

export interface Run {
  headers: Record<string, string>
  started: number
  trace: TraceStep[]
  usages: Usage[]
  model: string | null
}

export function noun(count: number, word: string): string {
  return `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`
}

/** Appends one finished stage to the trace, timed from `startedAt`. */
export function record(run: Run, name: string, status: StepStatus, startedAt: number, detail: string, usage?: Usage): void {
  run.trace.push({
    name,
    status,
    ms: Date.now() - startedAt,
    at: startedAt - run.started,
    detail,
    ...(usage?.total_tokens !== undefined ? { tokens: usage.total_tokens } : {}),
    ...(usage?.cost !== undefined ? { cost: usage.cost } : {}),
  })
}

/** Lists the stages a run never reached, so the trace always shows the whole pipeline. */
export function padSkipped(run: Run): void {
  const seen = new Set(run.trace.map((step) => step.name))
  const at = Date.now() - run.started
  for (const name of PIPELINE) {
    if (!seen.has(name)) run.trace.push({ name, status: 'skipped', ms: 0, at, detail: 'Not run: an earlier stage failed' })
  }
}

/** Adds up provider-reported usage. A field stays absent unless at least one call reported it. */
export function sumUsage(reports: Usage[]): Usage | null {
  const total: Usage = {}
  for (const field of USAGE_FIELDS) {
    const values = reports.map((r) => r[field]).filter((v): v is number => typeof v === 'number')
    if (values.length > 0) total[field] = values.reduce((sum, v) => sum + v, 0)
  }
  return Object.keys(total).length > 0 ? total : null
}
