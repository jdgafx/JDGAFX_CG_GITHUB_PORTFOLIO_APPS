import AnalysisPanel from './AnalysisPanel'
import DataPreview from './DataPreview'
import HistoryList from './HistoryList'
import RunMetrics from './RunMetrics'
import RunTrace from './RunTrace'
import type { AnalysisResult, HistoryEntry, ParsedData, RunOutcome, RunView } from '../types'

const OUTCOME: Record<RunOutcome, { label: string; tone: string }> = {
  done: { label: 'Completed', tone: 'ds-badge--success' },
  failed: { label: 'Failed', tone: 'ds-badge--danger' },
  stopped: { label: 'Stopped', tone: '' },
}

interface RunColumnProps {
  parsedData: ParsedData | null
  current: AnalysisResult | null
  run: RunView | null
  isLoading: boolean
  history: HistoryEntry[]
  onReopen: (entry: HistoryEntry) => void
}

/** Result text for the states that have no chart to show. */
function emptyResultText(parsedData: ParsedData | null, outcome: RunOutcome | undefined): string {
  if (!parsedData) return 'Pick a live dataset or upload a CSV to start.'
  if (outcome === 'failed') return 'No chart for this question. The message at the top says why.'
  if (outcome === 'stopped') return 'Stopped before a chart was drawn. Choose Plan and run to try again.'
  return 'Type a question, then choose Plan and run to draw a chart from your data.'
}

/** The run column: the result first, then the data, the model figures, the steps and the history. */
export default function RunColumn({ parsedData, current, run, isLoading, history, onReopen }: RunColumnProps) {
  return (
    <div className="ds-run">
      {isLoading ? (
        <section className="ds-section app-result" aria-busy="true" aria-label="Result in progress">
          <div className="ds-panel app-skeleton" />
        </section>
      ) : current ? (
        <AnalysisPanel result={current} />
      ) : (
        <section className="ds-section" aria-labelledby="result-title">
          <div className="ds-section__head">
            <h2 id="result-title" className="ds-section__title">Result</h2>
            <p className="ds-section__sub">The answer and chart appear here, drawn from every row.</p>
          </div>
          <p className="ds-empty">{emptyResultText(parsedData, run?.outcome)}</p>
        </section>
      )}

      {parsedData && parsedData.headers.length > 0 && <DataPreview data={parsedData} />}

      <section className="ds-section" aria-labelledby="readout-title">
        <div className="ds-section__head">
          <h2 id="readout-title" className="ds-section__title">Model and cost</h2>
          <p className="ds-section__sub">The served model, tokens, cost and latency for this run.</p>
        </div>
        {isLoading ? (
          <p className="ds-empty">Figures appear when the reply arrives.</p>
        ) : run ? (
          <RunMetrics run={run} />
        ) : (
          <p className="ds-empty">Figures appear here after the first run.</p>
        )}
      </section>

      <section className="ds-section" aria-labelledby="trace-title">
        <div className="ds-section__head ds-section__head--row">
          <h2 id="trace-title" className="ds-section__title">Agent run</h2>
          {run && !isLoading && (
            <span className={`ds-badge ${OUTCOME[run.outcome].tone}`}>{OUTCOME[run.outcome].label}</span>
          )}
        </div>
        <p className="ds-section__sub">
          Each step, in order, with its status, time and tokens. Steps that did not run are marked skipped.
        </p>
        {isLoading ? (
          <RunTrace pending />
        ) : run ? (
          <RunTrace steps={run.trace} />
        ) : (
          <p className="ds-empty">Each step appears here once a question runs, with its time and token use.</p>
        )}
      </section>

      <HistoryList entries={history} disabled={isLoading} onReopen={onReopen} />
    </div>
  )
}
