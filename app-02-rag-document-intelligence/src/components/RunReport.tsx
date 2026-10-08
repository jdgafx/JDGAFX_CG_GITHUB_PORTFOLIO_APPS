import type { LatestRun, RunReport as RunData, RunState, TraceStep } from '../types'

/** The state label in the Latest run card header. Null before any question. */
export function RunBadge({ running, state }: { running: boolean; state: RunState | null }) {
  if (running) return <span className="ds-badge ds-badge--accent">Running</span>
  switch (state) {
    case 'answered':
      return <span className="ds-badge ds-badge--success">Answered</span>
    case 'no-matches':
      return <span className="ds-badge">Model not called</span>
    case 'failed':
      return <span className="ds-badge ds-badge--danger">Failed</span>
    case 'stopped':
      return <span className="ds-badge">Stopped</span>
    default:
      return null
  }
}

function statusBadge(status: TraceStep['status']) {
  if (status === 'ok') return <span className="ds-badge ds-badge--success">ok</span>
  if (status === 'failed') return <span className="ds-badge ds-badge--danger">failed</span>
  return <span className="ds-badge">skipped</span>
}

function timing(step: TraceStep): string {
  if (step.status === 'skipped') return 'not run'
  if (step.ms === null) return 'not timed'
  return `${step.ms.toLocaleString('en-US')} ms`
}

function TraceList({ steps, pending }: { steps: TraceStep[]; pending: string | null }) {
  const slowest = Math.max(1, ...steps.map(step => step.ms ?? 0))
  return (
    <ol className="ds-trace" aria-label="Run steps">
      {steps.map((step, i) => (
        <li key={`${step.name}-${i}`} className="ds-trace__step">
          <span className="ds-trace__index">{i + 1}</span>
          <div>
            <p className="ds-trace__name">
              {step.name} {statusBadge(step.status)}
            </p>
            <p className="ds-trace__detail">{step.detail}</p>
            {step.ms !== null && step.status !== 'skipped' && (
              <div className="ds-trace__bar" style={{ width: `${Math.max(4, Math.round((step.ms / slowest) * 100))}%` }} />
            )}
          </div>
          <p className="ds-trace__meta">
            {timing(step)}
            {typeof step.tokens === 'number' && <><br />{step.tokens.toLocaleString('en-US')} tokens</>}
            {typeof step.cost === 'number' && <><br />${step.cost.toFixed(6)}</>}
          </p>
        </li>
      ))}
      {pending && (
        <li className="ds-trace__step">
          <span className="ds-trace__index">{steps.length + 1}</span>
          <div>
            <p className="ds-trace__name">
              {pending} <span className="ds-badge ds-badge--accent">running</span>
            </p>
            <p className="ds-trace__detail">Waiting for this step to finish.</p>
          </div>
          <p className="ds-trace__meta">in progress</p>
        </li>
      )}
    </ol>
  )
}

interface MetricsProps {
  report: RunData | null
  state: RunState | null
  waiting: boolean
}

/** Every value is measured, reported or labelled. Nothing is filled in with a guess. */
function Metrics({ report, state, waiting }: MetricsProps) {
  const usage = report?.usage ?? null
  const notCalled = state === 'no-matches'
  const count = (value: number | null | undefined): string => {
    if (waiting) return 'waiting'
    if (notCalled) return 'not called'
    return typeof value === 'number' ? value.toLocaleString('en-US') : 'not reported'
  }
  const cost = usage?.cost ?? null
  const costValue = waiting
    ? 'waiting'
    : notCalled
      ? 'not called'
      : cost === null
        ? 'not reported'
        : `$${cost.toFixed(6)}${usage?.cost_source === 'estimated' ? ' (estimated)' : ''}`
  const costHint = usage?.cost_source === 'estimated'
    ? 'Estimated from catalogue pricing and token counts.'
    : usage?.cost_source === 'reported'
      ? "From the provider's usage report."
      : 'No cost was reported.'
  const latency = report?.totalMs ?? null

  const items = [
    {
      label: 'Total latency',
      value: waiting ? 'waiting' : latency === null ? 'not reported' : `${latency.toLocaleString('en-US')} ms`,
      hint: notCalled ? 'Measured in this browser. The model was not called.' : 'Measured on the server.',
    },
    { label: 'Prompt tokens', value: count(usage?.prompt_tokens), hint: "From the provider's usage report." },
    { label: 'Completion tokens', value: count(usage?.completion_tokens), hint: "From the provider's usage report." },
    { label: 'Total tokens', value: count(usage?.total_tokens), hint: 'Summed over every model call in the run.' },
    { label: 'Cost (USD)', value: costValue, hint: costHint },
    {
      label: 'Served model',
      value: waiting ? 'waiting' : report?.model ?? (notCalled ? 'not called' : 'not reported'),
      hint: 'As named in the provider response.',
    },
  ]

  return (
    <div className="ds-metrics" role="group" aria-label="Run metrics">
      {items.map(item => (
        <div className="ds-metric" key={item.label}>
          <p className="ds-metric__label">{item.label}</p>
          <p className="ds-metric__value docmind-wrap">{item.value}</p>
          <p className="ds-metric__hint">{item.hint}</p>
        </div>
      ))}
    </div>
  )
}

interface RunReportProps {
  running: boolean
  pending: string | null
  liveTrace: TraceStep[]
  latest: LatestRun | null
}

/** The trace and metrics for the question in progress, or for the latest one once it has finished. */
export function RunReport({ running, pending, liveTrace, latest }: RunReportProps) {
  if (running) {
    return (
      <div className="docmind-run">
        <TraceList steps={liveTrace} pending={pending} />
        <Metrics report={null} state={null} waiting />
      </div>
    )
  }
  if (!latest) {
    return (
      <div className="ds-empty">
        <p className="ds-hint">Ask a question to see each step, how long it took, and the tokens and cost it used.</p>
      </div>
    )
  }
  return (
    <div className="docmind-run">
      <TraceList steps={latest.report.trace} pending={null} />
      <Metrics report={latest.report} state={latest.state} waiting={false} />
    </div>
  )
}
