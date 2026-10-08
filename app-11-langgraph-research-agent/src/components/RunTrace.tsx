import type { ReactNode } from 'react'
import type { ResultFrame } from '../../netlify/shared/events'
import { costHint, costSourceText, count, milliseconds, plural, usd } from '../lib/format'
import type { RunView, TraceEntry } from '../lib/runState'

const STATUS_BADGE: Record<TraceEntry['status'], { label: string; tone: string }> = {
  running: { label: 'Running', tone: 'ds-badge--accent' },
  ok: { label: 'OK', tone: 'ds-badge--success' },
  failed: { label: 'Failed', tone: 'ds-badge--danger' },
  skipped: { label: 'Skipped', tone: '' },
}

function modelLine(entry: TraceEntry): string {
  if (entry.servedModel) return `served by ${entry.servedModel}`
  if (entry.model) return `asked for ${entry.model}, served model not reported`
  return 'no model call'
}

function costLine(entry: TraceEntry): string {
  if (entry.cost === undefined) return 'cost not reported'
  return `${usd(entry.cost)} (${entry.costSource ? costSourceText[entry.costSource] : 'cost'})`
}

interface TraceRowProps {
  index: number
  entry: TraceEntry
  totalMs: number
}

function TraceRow({ index, entry, totalMs }: TraceRowProps) {
  const badge = STATUS_BADGE[entry.status]
  const share = entry.ms !== undefined && totalMs > 0 ? Math.max(2, Math.round((entry.ms / totalMs) * 100)) : 0
  const tokens = entry.usage?.total_tokens

  return (
    <li className="ds-trace__step">
      <span className="ds-trace__index">{index}</span>
      <div>
        <div className="ds-trace__name">
          {`${entry.node}, visit ${entry.visit}`} <span className={`ds-badge ${badge.tone}`}>{badge.label}</span>
        </div>
        <div className="ds-trace__detail">{entry.detail}</div>
        {share > 0 && <div className="ds-trace__bar" style={{ width: `${share}%` }} />}
      </div>
      <div className="ds-trace__meta">
        {entry.ms === undefined ? '—' : milliseconds(entry.ms)}
        {entry.model && <div>{modelLine(entry)}</div>}
        {tokens !== undefined && <div>{plural(tokens, 'token')}</div>}
        {entry.model && <div>{costLine(entry)}</div>}
      </div>
    </li>
  )
}

interface MetricProps {
  label: string
  value: string
  hint?: string
  small?: boolean
}

function Metric({ label, value, hint, small = false }: MetricProps) {
  return (
    <div className="ds-metric">
      <div className="ds-metric__label">{label}</div>
      <div className={small ? 'ds-metric__value metric-value--small' : 'ds-metric__value'}>{value}</div>
      {hint && <div className="ds-metric__hint">{hint}</div>}
    </div>
  )
}

function Metrics({ result }: { result: ResultFrame }) {
  const { totals } = result
  return (
    <div className="ds-metrics">
      <Metric label="Total time" value={milliseconds(totals.ms)} hint="Start to answer" />
      <Metric
        label="Total tokens"
        value={totals.tokens === undefined ? 'not reported' : count(totals.tokens)}
        hint="All model calls"
      />
      <Metric
        label="Total cost (USD)"
        value={totals.cost === undefined ? 'not reported' : usd(totals.cost)}
        hint={costHint(totals)}
      />
      <Metric
        label="Models used"
        value={result.models.length > 0 ? result.models.join(', ') : 'not reported'}
        hint="Named in the provider replies"
        small
      />
    </div>
  )
}

interface RunTraceProps {
  view: RunView
}

export function RunTrace({ view }: RunTraceProps) {
  const totalMs = view.result?.totals.ms ?? 0
  let content: ReactNode
  if (view.trace.length === 0) {
    content = (
      <div className="ds-empty">
        Run a question to see each node, how long it took, and the model, tokens and cost it used.
      </div>
    )
  } else {
    content = (
      <>
        <ol className="ds-trace">
          {view.trace.map((entry, i) => (
            <TraceRow key={entry.key} index={i + 1} entry={entry} totalMs={totalMs} />
          ))}
        </ol>
        {view.result && <Metrics result={view.result} />}
      </>
    )
  }

  return (
    <section className="ds-card" aria-labelledby="trace-title">
      <div className="ds-card__head">
        <h2 id="trace-title" className="ds-card__title">Run trace</h2>
        <span className="ds-hint">Times in milliseconds, one row per node visit</span>
      </div>
      <div className="ds-stack">{content}</div>
    </section>
  )
}
