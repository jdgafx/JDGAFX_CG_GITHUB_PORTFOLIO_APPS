import { describePlan, describeResult } from '../lib/answer'
import { topGroup } from '../lib/dataEngine'
import { answerDirection } from '../lib/queryPlan'
import type { AnalysisResult } from '../types'
import ChartView from './ChartView'

const PLAN_PARTS = [
  ['Group by', 'groupBy'],
  ['Measure', 'measure'],
  ['Filter rows', 'filter'],
  ['Keep groups where', 'having'],
  ['Sort', 'sort'],
] as const

/** The hero: the one-sentence answer, the plan in plain words, then the chart it came from. */
export default function AnalysisPanel({ result }: { result: AnalysisResult }) {
  const { queryPlan: plan } = result
  const headline = describeResult(plan, topGroup(result, answerDirection(plan)), result)
  const words = describePlan(plan)

  return (
    <section className="ds-section app-result" aria-labelledby="result-title">
      <div className="ds-section__head ds-section__head--row">
        <h2 id="result-title" className="ds-section__title">{plan.title}</h2>
        <span className={`ds-badge ${headline.substitute ? 'ds-badge--warning' : ''}`}>
          {headline.substitute ? 'Substitute chart' : `${plan.chartType} chart`}
        </span>
      </div>
      <p className="ds-section__sub">Question: {result.question}</p>

      {headline.notice && (
        <p className="app-notice app-notice--lead" role="note">
          <strong>Not in this data.</strong> {headline.notice}
        </p>
      )}
      {headline.answer && (
        <p className={`app-answer ds-num ${headline.substitute ? 'app-answer--substitute' : ''}`}>
          {headline.substitute && <span className="ds-badge ds-badge--warning">Substitute result</span>}
          {headline.answer}
        </p>
      )}

      <dl className="app-plan-words">
        {PLAN_PARTS.filter(([, part]) => words[part] !== null).map(([label, part]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{words[part]}</dd>
          </div>
        ))}
      </dl>

      <ChartView result={result} />

      {result.warnings.map((warning) => (
        <p key={warning} className="ds-help">{warning}</p>
      ))}
      {headline.note && <p className="ds-help">{headline.note}</p>}
      {plan.explanation && <p className="ds-help">{plan.explanation}</p>}

      <details className="app-details">
        <summary>Query plan as JSON</summary>
        <pre className="app-plan">
          {JSON.stringify(
            {
              chartType: plan.chartType,
              groupBy: plan.groupBy,
              aggregate: plan.aggregate,
              ...(plan.filter ? { filter: plan.filter } : {}),
              ...(plan.having ? { having: plan.having } : {}),
              ...(plan.sortBy ? { sortBy: plan.sortBy } : {}),
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  )
}
