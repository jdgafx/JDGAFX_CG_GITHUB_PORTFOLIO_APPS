import { formatCount, formatMs, formatUsd, type RunTotals } from '../lib/run'

interface ReadoutProps {
  label: string
  value: string
  hint: string
  mono?: boolean
}

function Readout({ label, value, hint, mono = false }: ReadoutProps) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className={mono ? 'ds-strip__value ds-mono' : 'ds-strip__value ds-num'}>{value}</dd>
      <dd className="ds-strip__hint">{hint}</dd>
    </div>
  )
}

function callsWord(count: number): string {
  return count === 1 ? 'call' : 'calls'
}

function usageHint(reported: number, calls: number): string {
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
        <p className="ds-section__sub">Figures add up every model call in this run. A figure that no call reported says so.</p>
      </div>

      {!totals ? (
        <div className="ds-empty">Totals appear after the first model call. Press Generate to start.</div>
      ) : (
        <DetailTotals totals={totals} />
      )}
    </section>
  )
}

function DetailTotals({ totals }: { totals: RunTotals }) {
  const { calls } = totals
  const costHint = totals.costCalls === calls
    ? 'Reported by the provider'
    : totals.costCalls === 0
      ? 'No call reported a cost'
      : `${totals.costCalls} of ${calls} calls reported a cost`

  return (
    <dl className="ds-strip">
      <Readout label="Total latency" value={formatMs(totals.ms)} hint={`Sum of ${calls} ${callsWord(calls)}`} />
      <Readout
        label="Prompt tokens"
        value={totals.promptTokens === null ? 'not reported' : formatCount(totals.promptTokens)}
        hint={usageHint(totals.usageCalls, calls)}
      />
      <Readout
        label="Completion tokens"
        value={totals.completionTokens === null ? 'not reported' : formatCount(totals.completionTokens)}
        hint={usageHint(totals.usageCalls, calls)}
      />
      <Readout
        label="Total tokens"
        value={totals.totalTokens === null ? 'not reported' : formatCount(totals.totalTokens)}
        hint={usageHint(totals.usageCalls, calls)}
      />
      <Readout
        label="Cost (USD)"
        value={totals.cost === null ? 'not reported' : formatUsd(totals.cost)}
        hint={costHint}
      />
      <Readout
        label="Served model"
        value={totals.models.length > 0 ? totals.models.join(', ') : 'not reported'}
        hint="As reported by the provider"
        mono
      />
    </dl>
  )
}
