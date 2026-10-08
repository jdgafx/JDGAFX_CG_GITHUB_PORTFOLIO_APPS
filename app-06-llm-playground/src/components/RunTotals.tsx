import { formatCount, formatMs, formatUsd } from '../lib/format'
import { runTotals, type RunTotals, type RunView } from '../lib/run'
import { Metric } from './Metric'

export function RunTotalsStrip({ run }: { run: RunView | null }) {
  return (
    <section className="ds-section" aria-labelledby="totals-title">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="totals-title">
          Run totals
        </h2>
        <p className="ds-section__sub">
          Time covers the compare call and the judge. Tokens and cost cover the answering panels.
        </p>
      </div>
      {run ? <Strip totals={runTotals(run)} /> : <div className="ds-empty">Totals appear here after a comparison.</div>}
    </section>
  )
}

function Strip({ totals }: { totals: RunTotals }) {
  // Model IDs contain a slash. Status words such as "not run" stay in the body font.
  const judgeIsId = totals.judgeModel.includes('/')
  return (
    <div className="ds-strip arena-strip">
      <Metric label="Run time" value={formatMs(totals.runMs)} hint="Panels plus judge" />
      <Metric label="Prompt tokens" value={formatCount(totals.promptTokens)} hint={answeringLabel(totals)} />
      <Metric label="Output tokens" value={formatCount(totals.outputTokens)} />
      <Metric label="Total tokens" value={formatCount(totals.totalTokens)} />
      <Metric
        label="Panel cost"
        value={totals.panelCost ? formatUsd(totals.panelCost.usd) : 'not reported'}
        hint={costLabel(totals)}
      />
      <Metric label="Judge model" value={totals.judgeModel} mono={judgeIsId} hint="Opinion, not measured" />
    </div>
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
