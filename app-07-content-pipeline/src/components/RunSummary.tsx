import { formatCount, formatMs, formatUsd, type RunTotals } from '../lib/run'

interface ReadoutProps {
  label: string
  value: string
  hint: string
  className?: string
}

function Readout({ label, value, hint, className = 'ds-num' }: ReadoutProps) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className={`ds-strip__value ${className}`}>{value}</dd>
      <dd className="ds-strip__hint">{hint}</dd>
    </div>
  )
}

function callsWord(count: number): string {
  return count === 1 ? 'call' : 'calls'
}

function usageHint(reported: number, calls: number): string {
  if (calls === 0) return 'No model call yet'
  if (reported === calls) return `All ${calls} ${callsWord(calls)} reported usage`
  if (reported === 0) return 'No call reported usage'
  return `${reported} of ${calls} calls reported usage`
}

interface RunSummaryProps {
  totals: RunTotals | null
}

export default function RunSummary({ totals }: RunSummaryProps) {
  return (
    <section className="ds-section" aria-labelledby="totals-title">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="totals-title">Run totals</h2>
        <p className="ds-section__sub">Figures add up every call in this run. Tokens and cost cover the model calls; the source lookup has none. A figure that no call reported says so.</p>
      </div>

      {totals ? <Totals totals={totals} /> : (
        <div className="ds-empty">Totals appear after the first call. Press Generate to start.</div>
      )}
    </section>
  )
}

function Totals({ totals }: { totals: RunTotals }) {
  const { calls, modelCalls } = totals
  const costHint = modelCalls === 0
    ? 'No model call yet'
    : totals.costCalls === modelCalls
    ? 'Reported by the provider'
    : totals.costCalls === 0
      ? 'No call reported a cost'
      : `${totals.costCalls} of ${modelCalls} calls reported a cost`
  const notReported = (value: number | null, format: (n: number) => string) => (value === null ? 'not reported' : format(value))

  return (
    <dl className="ds-strip">
      <Readout label="Total latency" value={formatMs(totals.ms)} hint={`Sum of ${calls} ${callsWord(calls)}`} />
      <Readout label="Prompt tokens" value={notReported(totals.promptTokens, formatCount)} hint={usageHint(totals.usageCalls, modelCalls)} />
      <Readout label="Completion tokens" value={notReported(totals.completionTokens, formatCount)} hint={usageHint(totals.usageCalls, modelCalls)} />
      <Readout label="Total tokens" value={notReported(totals.totalTokens, formatCount)} hint={usageHint(totals.usageCalls, modelCalls)} />
      <Readout label="Cost (USD)" value={notReported(totals.cost, formatUsd)} hint={costHint} />
      <Readout
        label="Served model"
        value={totals.models.length > 0 ? totals.models.join(', ') : 'not reported'}
        hint="As reported by the provider"
        className="ds-mono"
      />
    </dl>
  )
}
