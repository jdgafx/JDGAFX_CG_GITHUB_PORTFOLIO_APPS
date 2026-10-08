import { answerSentence, describePlan } from '../lib/answer'
import { topGroup } from '../lib/dataEngine'
import type { AnalysisResult } from '../types'
import ChartView from './ChartView'

/** The hero: the one-sentence answer, the plan in plain words, then the chart it came from. */
export default function AnalysisPanel({ result }: { result: AnalysisResult }) {
  const { queryPlan: plan } = result
  const answer = answerSentence(plan, topGroup(result))
  const words = describePlan(plan)

  return (
    <section className="ds-section app-result" aria-labelledby="result-title">
      <div className="ds-section__head ds-section__head--row">
        <h2 id="result-title" className="ds-section__title">{plan.title}</h2>
        <span className="ds-badge">{plan.chartType} chart</span>
      </div>
      <p className="ds-section__sub">Question: {result.question}</p>

      {answer && <p className="app-answer ds-num">{answer}</p>}

      <dl className="app-plan-words">
        <div>
          <dt>Group by</dt>
          <dd>{words.groupBy}</dd>
        </div>
        <div>
          <dt>Measure</dt>
          <dd>{words.measure}</dd>
        </div>
        <div>
          <dt>Filter</dt>
          <dd>{words.filter}</dd>
        </div>
        <div>
          <dt>Sort</dt>
          <dd>{words.sort}</dd>
        </div>
      </dl>

      <ChartView result={result} />

      {plan.notice && <p className="app-notice">{plan.notice}</p>}
      {result.warnings.map((warning) => (
        <p key={warning} className="ds-help">{warning}</p>
      ))}
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
