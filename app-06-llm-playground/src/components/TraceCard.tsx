import { barPercent, formatCount, formatMs, formatUsd } from '../lib/format'
import { runTotals, traceSteps, type RunTotals, type RunView, type StepStatus } from '../lib/run'
import { Metric } from './Metric'

const STEP_TONE: Record<StepStatus, string> = {
  ok: 'ds-badge--success',
  failed: 'ds-badge--danger',
  skipped: '',
  running: 'ds-badge--accent',
}

export function TraceCard({ run }: { run: RunView | null }) {
  return (
    <section className="ds-card" aria-labelledby="trace-title">
      <div className="ds-card__head">
        <h2 className="ds-card__title" id="trace-title">Run trace</h2>
        <span className="ds-hint">Times are measured on the server</span>
      </div>
      {run ? <Trace run={run} /> : <div className="ds-empty">No run yet. Each step and the run totals appear here.</div>}
    </section>
  )
}

function Trace({ run }: { run: RunView }) {
  const steps = traceSteps(run)
  const scale = Math.max(0, ...steps.map(step => step.ms ?? 0))
  const totals = runTotals(run)
  return (
    <>
      <ol className="ds-trace">
        {steps.map((step, i) => (
          <li className="ds-trace__step" key={step.name}>
            <span className="ds-trace__index">{i + 1}</span>
            <div>
              <div className="ds-row">
                <span className="ds-trace__name">{step.name}</span>
                <span className={`ds-badge ${STEP_TONE[step.status]}`}>{step.status}</span>
              </div>
              <p className="ds-trace__detail">{step.detail}</p>
              {step.ms !== null && (
                <div className="ds-trace__bar" aria-hidden="true" style={{ width: `${barPercent(step.ms, scale)}%` }} />
              )}
            </div>
            <div className="ds-trace__meta arena-meta">
              <span>{formatMs(step.ms)}</span>
              {step.tokens !== null && <span>{formatCount(step.tokens)} tokens</span>}
              {step.cost && <span>{formatUsd(step.cost.usd)}</span>}
            </div>
          </li>
        ))}
      </ol>
      <div className="ds-metrics arena-totals">
        <Metric label="Run time" value={formatMs(totals.runMs)} hint="Panels plus judge" />
        <Metric label="Prompt tokens" value={formatCount(totals.promptTokens)} hint={answeringLabel(totals)} />
        <Metric label="Output tokens" value={formatCount(totals.outputTokens)} />
        <Metric label="Total tokens" value={formatCount(totals.totalTokens)} />
        <Metric
          label="Panel cost"
          value={totals.panelCost ? formatUsd(totals.panelCost.usd) : 'not reported'}
          hint={costLabel(totals)}
        />
        <Metric label="Judge model" value={totals.judgeModel} hint="Opinion, not measured" />
      </div>
    </>
  )
}

function answeringLabel(totals: RunTotals): string {
  if (totals.answering === 0) return 'No panel answered'
  return `From ${totals.answering} answering ${totals.answering === 1 ? 'panel' : 'panels'}`
}

function costLabel(totals: RunTotals): string {
  if (totals.answering === 0) return 'No panel answered'
  const base = `${totals.costedPanels} of ${totals.answering} answering panels reported cost`
  return totals.panelCost?.source === 'estimated' ? `${base}, part estimated` : base
}
