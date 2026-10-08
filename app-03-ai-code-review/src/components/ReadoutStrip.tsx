import type { RunPhase, RunSummary } from '../types'

const count = (value: number) => value.toLocaleString('en-US')

const tokenText = (value: number | undefined) => (value === undefined ? 'not reported' : count(value))

const costText = (cost: number | undefined) => (cost === undefined ? 'not reported' : `$${cost.toFixed(6)}`)

interface FigureProps {
  label: string
  value: string
  hint?: string
  mono?: boolean
}

function Figure({ label, value, hint, mono = false }: FigureProps) {
  return (
    <div className="ds-strip__item">
      <div className="ds-strip__label">{label}</div>
      <div className={mono ? 'ds-strip__value ds-mono' : 'ds-strip__value'}>{value}</div>
      {hint && <div className="ds-help">{hint}</div>}
    </div>
  )
}

function emptyText(phase: RunPhase): string {
  if (phase === 'running') return 'Figures appear when the run finishes.'
  if (phase === 'failed') return 'No figures were recorded for this run.'
  return 'Run a review to see its time, tokens, cost and the model that answered.'
}

interface ReadoutStripProps {
  phase: RunPhase
  summary: RunSummary | null
}

export function ReadoutStrip({ phase, summary }: ReadoutStripProps) {
  return (
    <section className="ds-section" aria-labelledby="readout-title">
      <div className="ds-section__head">
        <h2 id="readout-title" className="ds-section__title">
          Run figures
        </h2>
        <p className="ds-section__sub">
          Time, tokens, cost and the model that answered. A figure the provider did not report says so.
        </p>
      </div>
      {summary ? (
        <div className="ds-strip readout">
          <Figure label="Total latency" value={`${count(summary.totalMs)} ms`} />
          <Figure label="Prompt tokens" value={tokenText(summary.usage?.prompt_tokens)} />
          <Figure label="Completion tokens" value={tokenText(summary.usage?.completion_tokens)} />
          <Figure label="Total tokens" value={tokenText(summary.usage?.total_tokens)} />
          <Figure
            label="Cost (USD)"
            value={costText(summary.usage?.cost)}
            hint={summary.usage?.cost === undefined ? 'The provider did not report a cost' : 'Reported by the provider'}
          />
          <Figure
            label="Served model"
            value={summary.model ?? 'not reported'}
            hint={summary.model ? "Named in the provider's reply" : 'The reply named no model'}
            mono={summary.model !== null}
          />
        </div>
      ) : (
        <div className="ds-empty">{emptyText(phase)}</div>
      )}
    </section>
  )
}
