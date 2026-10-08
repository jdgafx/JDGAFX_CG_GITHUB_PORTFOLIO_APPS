import { formatCount, formatMs, formatUsd } from '../lib/usage'
import type { StageUsage } from '../types'

export type MetricsState = 'idle' | 'running' | 'done'

interface RunMetricsProps {
  state: MetricsState
  totalMs?: number
  /** True when the run stopped before the server's total arrived, so the total is a sum of stage times. */
  totalIsStageSum: boolean
  usage: StageUsage
  model?: string
}

/** One figure in the readout strip. The model ID is the only figure set in mono. */
function Figure({ label, value, hint, mono }: { label: string; value: string; hint?: string; mono?: boolean }) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className={mono ? 'ds-strip__value ds-mono' : 'ds-strip__value ds-num'}>{value}</dd>
      {hint && <dd className="ds-strip__hint">{hint}</dd>}
    </div>
  )
}

export function RunMetrics({ state, totalMs, totalIsStageSum, usage, model }: RunMetricsProps) {
  if (state === 'idle') {
    return <p className="ds-empty">Start research to fill in the latency, tokens, cost and served model.</p>
  }

  const running = state === 'running'
  const pending = (text: string) => (running ? '-' : text)
  const costHint = running
    ? 'Filled in when the run ends'
    : usage.cost === undefined
      ? 'The provider sent no cost'
      : 'Reported by the provider'

  return (
    <dl className="ds-strip app-readout">
      <Figure
        label="Total latency"
        value={formatMs(totalMs)}
        hint={running ? 'Running' : totalIsStageSum ? 'Sum of stage times' : 'Measured on the server'}
      />
      <Figure label="Prompt tokens" value={pending(formatCount(usage.prompt_tokens))} />
      <Figure label="Completion tokens" value={pending(formatCount(usage.completion_tokens))} />
      <Figure label="Total tokens" value={pending(formatCount(usage.total_tokens))} />
      <Figure label="Cost (USD)" value={pending(formatUsd(usage.cost))} hint={costHint} />
      <Figure
        label="Served model"
        value={pending(model ?? 'not reported')}
        hint={running ? undefined : 'From the provider response'}
        mono
      />
    </dl>
  )
}
