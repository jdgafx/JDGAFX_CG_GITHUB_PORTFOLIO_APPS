import { answerSentence } from '../lib/answer'
import { topGroup } from '../lib/dataEngine'
import type { AnalysisResult } from '../types'
import ChartView from './ChartView'

export default function AnalysisPanel({ result }: { result: AnalysisResult }) {
  const { queryPlan: plan } = result
  const answer = answerSentence(plan, topGroup(result))

  return (
    <section className="ds-card app-result" aria-labelledby="result-title">
      <div className="ds-card__head">
        <h2 id="result-title" className="ds-card__title">{plan.title}</h2>
        <span className="ds-badge ds-badge--accent">{plan.chartType} chart</span>
      </div>
      <p className="ds-hint">Question: {result.question}</p>

      <div className="app-stack">
        <ChartView result={result} />
        {answer && <p className="app-answer">{answer}</p>}
        {plan.notice && <p className="ds-notice">{plan.notice}</p>}
        {result.warnings.map((warning) => (
          <p key={warning} className="ds-hint">{warning}</p>
        ))}
        {plan.explanation && <p className="ds-hint">{plan.explanation}</p>}
        <details className="app-details">
          <summary>Query plan</summary>
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
      </div>
    </section>
  )
}
