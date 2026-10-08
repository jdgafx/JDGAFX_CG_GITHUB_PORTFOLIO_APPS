import { formatCost, formatMs, formatTokens } from '../lib/format'
import type { RunView } from '../lib/run-state'
import { totalsOf } from '../lib/totals'

/** The whole run's figures in one row under the graph. A value the provider did not report reads "not reported". */
export function Readout({ run }: { run: RunView }) {
  const totals = run.result?.totals ?? totalsOf(run.trace)
  const costValue = totals.cost === null ? 'not reported' : formatCost(totals.cost, totals.costSource ?? undefined)
  const modelValue = totals.models.length > 0 ? totals.models.join(', ') : 'not reported'

  return (
    <dl className="ds-strip gg-readout">
      <div className="ds-strip__item">
        <dt className="ds-strip__label">Run time</dt>
        <dd className="ds-strip__value ds-num">{formatMs(totals.nodeMs)}</dd>
        <dd className="ds-help">Sum of the steps that ran.</dd>
      </div>
      <div className="ds-strip__item">
        <dt className="ds-strip__label">Tokens</dt>
        <dd className="ds-strip__value ds-num">{formatTokens(totals.tokens)}</dd>
      </div>
      <div className="ds-strip__item">
        <dt className="ds-strip__label">Cost</dt>
        <dd className="ds-strip__value ds-num">{costValue}</dd>
        {totals.costSource === 'estimated' ? <dd className="ds-help">From list prices.</dd> : null}
      </div>
      <div className="ds-strip__item gg-readout__wide">
        <dt className="ds-strip__label">Served models</dt>
        <dd className="ds-strip__value ds-mono">{modelValue}</dd>
      </div>
    </dl>
  )
}
