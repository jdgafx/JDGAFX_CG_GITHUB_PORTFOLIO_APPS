import type { LatestRun, RunReport as RunData, RunState, TraceStep } from '../types'

type Mark = 'ok' | 'failed' | 'skipped' | 'running'

/** A status mark beside its word. Colour never carries the state alone. */
function Dot({ mark }: { mark: Mark }) {
  return <span className={`ds-dot ds-dot--${mark}`} aria-hidden="true" />
}

/** The state label in the Latest run section header. Null before any question. */
function RunBadge({ running, state }: { running: boolean; state: RunState | null }) {
  if (running) {
    return (
      <span className="ds-badge ds-badge--accent">
        <Dot mark="running" />
        Running
      </span>
    )
  }
  switch (state) {
    case 'answered':
      return (
        <span className="ds-badge ds-badge--success">
          <Dot mark="ok" />
          Answered
        </span>
      )
    case 'no-matches':
      return (
        <span className="ds-badge">
          <Dot mark="skipped" />
          Model not called
        </span>
      )
    case 'failed':
      return (
        <span className="ds-badge ds-badge--danger">
          <Dot mark="failed" />
          Failed
        </span>
      )
    case 'stopped':
      return (
        <span className="ds-badge">
          <Dot mark="skipped" />
          Stopped
        </span>
      )
    default:
      return null
  }
}

function statusBadge(status: TraceStep['status']) {
  if (status === 'ok') {
    return (
      <span className="ds-badge ds-badge--success">
        <Dot mark="ok" />
        Done
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="ds-badge ds-badge--danger">
        <Dot mark="failed" />
        Failed
      </span>
    )
  }
  return (
    <span className="ds-badge">
      <Dot mark="skipped" />
      Skipped
    </span>
  )
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
            {typeof step.tokens === 'number' && (
              <>
                <br />
                {step.tokens.toLocaleString('en-US')} tokens
              </>
            )}
            {typeof step.cost === 'number' && (
              <>
                <br />${step.cost.toFixed(6)}
              </>
            )}
          </p>
        </li>
      ))}
      {pending && (
        <li className="ds-trace__step ds-trace__step--running">
          <span className="ds-trace__index">{steps.length + 1}</span>
          <div>
            <p className="ds-trace__name">
              {pending}{' '}
              <span className="ds-badge ds-badge--accent">
                <Dot mark="running" />
                Running
              </span>
            </p>
            <p className="ds-trace__detail">Waiting for this step to finish.</p>
          </div>
          <p className="ds-trace__meta">In progress</p>
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

interface ReadoutItem {
  label: string
  value: string
  hint: string
  /** Model IDs are the one thing set in the code face. */
  mono?: boolean
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

  const items: ReadoutItem[] = [
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
      mono: true,
    },
  ]

  return (
    <div className="ds-strip" role="group" aria-label="Run figures">
      {items.map(item => (
        <div className="ds-strip__item" key={item.label}>
          <p className="ds-strip__label">{item.label}</p>
          <p className={item.mono ? 'ds-strip__value ds-mono docmind-wrap' : 'ds-strip__value docmind-wrap'}>{item.value}</p>
          <p className="ds-strip__hint">{item.hint}</p>
        </div>
      ))}
    </div>
  )
}

interface RunSectionProps {
  running: boolean
  pending: string | null
  liveTrace: TraceStep[]
  latest: LatestRun | null
}

/** The figures and the numbered trace for the question in progress, or for the latest one once it has finished. */
export function RunSection({ running, pending, liveTrace, latest }: RunSectionProps) {
  return (
    <section className="ds-section" aria-labelledby="section-run">
      <div className="ds-section__head">
        <div className="docmind-head-row">
          <h2 id="section-run" className="ds-section__title">
            Latest run
          </h2>
          <RunBadge running={running} state={latest?.state ?? null} />
        </div>
        <p className="ds-section__sub">Each step of the latest question, with its timing, tokens and cost.</p>
      </div>

      {running ? (
        <div className="ds-stack">
          <Metrics report={null} state={null} waiting />
          <TraceList steps={liveTrace} pending={pending} />
        </div>
      ) : latest ? (
        <div className="ds-stack">
          <Metrics report={latest.report} state={latest.state} waiting={false} />
          <TraceList steps={latest.report.trace} pending={null} />
        </div>
      ) : (
        <div className="ds-empty">
          <p className="ds-help">Ask a question to see each step, how long it took, and the tokens and cost it used.</p>
        </div>
      )}
    </section>
  )
}
