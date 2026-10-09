import type { AnalysisThreadState } from '../hooks/useAnalysisThread'
import type { ParsedData } from '../types'
import DataPreview from './DataPreview'
import HistoryList from './HistoryList'
import ReadoutStrip from './ReadoutStrip'
import RunTrace from './RunTrace'
import ThreadPanel from './ThreadPanel'

interface RunColumnProps {
  parsedData: ParsedData | null
  datasetLabel: string
  state: AnalysisThreadState
  lastQuestion: string
  onAskFollowUp: (question: string) => void
  onRetry: () => void
}

/** What the result block says when there is no thread to show. */
function emptyText(parsedData: ParsedData | null): { title: string; body: string } {
  if (!parsedData) return { title: 'No data yet', body: 'Pick a live dataset or upload a CSV to start.' }
  return {
    title: 'Ask a question',
    body: 'Type a question, then choose Plan and run. Your answer, its chart and the plan behind it appear here. Then refine it with follow-ups.',
  }
}

/** The run column, in the order of the ended state: the thread, the chart, the figures, the trace, then the rest. */
export default function RunColumn({ parsedData, datasetLabel, state, lastQuestion, onAskFollowUp, onRetry }: RunColumnProps) {
  const { thread, run, pending, error } = state
  const running = pending !== null
  const freshRun = pending?.mode === 'new'
  const earlier = state.threads.filter((item) => item.id !== thread?.id)
  const empty = emptyText(parsedData)

  return (
    <div className="ds-run">
      <div className="ds-run__result app-result">
        {freshRun && (
          <div className="ds-state ds-state--loading" role="status" aria-busy="true">
            <span className="ds-state__mark" aria-hidden="true" />
            <p className="ds-state__title">Planning and running your question</p>
            <p className="ds-state__body">{pending.question}</p>
            <div className="ds-skeleton"><span /><span /><span /></div>
            <div className="ds-state__actions">
              <button type="button" className="ds-button" onClick={state.stop}>Stop</button>
            </div>
          </div>
        )}
        {!running && run?.outcome === 'failed' && (
          <div className="ds-state ds-state--error" role="alert">
            <span className="ds-state__mark" aria-hidden="true" />
            <p className="ds-state__title" tabIndex={-1} data-result-focus>The run failed</p>
            <p className="ds-state__body">{error ?? 'The analysis could not be completed.'}</p>
            <div className="ds-state__actions">
              {lastQuestion && <button type="button" className="ds-button" onClick={onRetry}>Try again</button>}
              <button type="button" className="ds-button ds-button--quiet" onClick={state.dismissError}>Dismiss</button>
            </div>
          </div>
        )}
        {!running && run?.outcome === 'stopped' && (
          <div className="ds-state ds-state--stopped" role="status">
            <span className="ds-state__mark" aria-hidden="true" />
            <p className="ds-state__title" tabIndex={-1} data-result-focus>Stopped before a reply</p>
            <p className="ds-state__body">
              Nothing was drawn for that question. The server may still finish the call and bill its tokens.
            </p>
            <div className="ds-state__actions">
              {lastQuestion && <button type="button" className="ds-button" onClick={onRetry}>Ask again</button>}
            </div>
          </div>
        )}
        {!freshRun && thread && (
          <ThreadPanel state={state} data={parsedData} datasetLabel={datasetLabel} onAskFollowUp={onAskFollowUp} />
        )}
        {!freshRun && !thread && !run && (
          <div className="ds-state ds-state--empty">
            <span className="ds-state__mark" aria-hidden="true" />
            <p className="ds-state__title">{empty.title}</p>
            <p className="ds-state__body">{empty.body}</p>
          </div>
        )}
      </div>

      <ReadoutStrip running={running} run={run} />

      <div className="ds-run__trace app-below">
        <RunTrace run={run} running={running} />
        <HistoryList threads={earlier} disabled={running} onOpen={state.openThread} />
        {parsedData && parsedData.headers.length > 0 && <DataPreview data={parsedData} />}
      </div>
    </div>
  )
}
