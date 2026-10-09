import { TRACE_STAGES, type TraceStep } from '../lib/api'
import type { InsightRun, RunStatus } from '../lib/insightRun'
import RunMetrics from './RunMetrics'
import RunTrace from './RunTrace'

interface InsightsPanelProps {
  run: InsightRun
}

// The server's own wording, for example "2 of 3 figures match the summary" or "1 of 1 figure matches the summary".
const COUNT_LINE = /^(\d+) of (\d+) (figures? match(?:es)? the summary[\s\S]*)$/

const CHECK_WORD: Record<TraceStep['status'], string> = {
  ok: 'Figures match',
  failed: 'Figures differ',
  skipped: 'Figures not checked',
}

/** One line of plain words for the status region. The verb matches the button that starts the run. */
function statusLine(status: RunStatus, openIndex: number, anyFailedStep: boolean): string {
  if (status === 'running') {
    const next = openIndex >= 0 ? TRACE_STAGES[openIndex] : undefined
    return next
      ? `Generating insights. Step ${openIndex + 1} of ${TRACE_STAGES.length}: ${next.name}.`
      : 'Generating insights. Finishing the run.'
  }
  if (status === 'done') {
    return anyFailedStep ? 'Analysis complete, with a failed check. See the trace.' : 'Analysis complete'
  }
  if (status === 'failed') return 'Run failed. Generate insights to try again.'
  if (status === 'stopped') return 'Stopped. The text above is what arrived before you stopped.'
  return 'Ready. The model has not been called yet.'
}

interface FigureCheckProps {
  step: TraceStep | undefined
  running: boolean
  stopped: boolean
}

/** The hero readout: how many figures in the answer match the snapshot, shown beside the streamed text. */
function FigureCheck({ step, running, stopped }: FigureCheckProps) {
  if (!step) {
    return (
      <div className="hub-check">
        <p className="hub-check__line">
          {running
            ? 'The check runs after the answer finishes.'
            : stopped
              ? 'The check did not run because the run stopped.'
              : 'The check did not run.'}
        </p>
        <p className={running ? 'hub-check__state hub-check__state--running' : 'hub-check__state'}>
          <span className={running ? 'ds-dot ds-dot--running' : 'ds-dot ds-dot--skipped'} aria-hidden="true" />
          {running ? 'Check waiting' : 'Check not run'}
        </p>
      </div>
    )
  }

  const match = step.status === 'skipped' ? null : COUNT_LINE.exec(step.detail)
  return (
    <div className="hub-check">
      <p className="hub-check__line">
        {match ? (
          <>
            <span className="hub-check__count ds-num">{`${match[1]} of ${match[2]}`}</span> {match[3]}
          </>
        ) : (
          step.detail
        )}
      </p>
      <p className={`hub-check__state hub-check__state--${step.status}`}>
        <span className={`ds-dot ds-dot--${step.status}`} aria-hidden="true" />
        {CHECK_WORD[step.status]}
      </p>
    </div>
  )
}

/** The run column: the status line, the figure check beside the streamed answer, then the run metrics and trace. */
export default function InsightsPanel({ run }: InsightsPanelProps) {
  const { status, steps, answer, outcome, totalMs, errorMessage } = run
  const running = status === 'running'
  const openIndex = TRACE_STAGES.findIndex((stage) => !steps.some((step) => step.name === stage.name))
  const anyFailedStep = steps.some((step) => step.status === 'failed')
  const checkStep = steps.find((step) => step.name === 'Check figures')
  const finished = status === 'done' || status === 'failed'
  const answerText = answer || (running ? 'Waiting for the first words…' : 'No answer was produced for this run.')

  return (
    <div className="hub-insights">
      <section className="ds-section" aria-labelledby="insights-title">
        <div className="ds-section__head">
          <h2 id="insights-title" className="ds-section__title">
            Insights
          </h2>
          <p className="ds-section__sub">
            Each percentage and download count the model quotes is checked against the figures above. A failed check does not fail the run.
          </p>
        </div>

        <p role="status" className="hub-status">
          {statusLine(status, openIndex, anyFailedStep)}
        </p>

        {status === 'failed' && (
          <div role="alert" className="ds-notice ds-notice--error">
            {errorMessage}
          </div>
        )}

        {status === 'idle' ? (
          <div className="ds-empty">
            No analysis yet. Generate insights sends the computed figures to the model. The answer streams in here, and
            the figure check then reports how many of its numbers match those figures.
          </div>
        ) : (
          <div className="ds-panel hub-result">
            <FigureCheck step={checkStep} running={running} stopped={status === 'stopped'} />
            <div className="hub-answer" aria-live="polite" aria-busy={running}>
              {answerText}
            </div>
          </div>
        )}
      </section>

      <RunMetrics ready={finished} totalMs={totalMs} usage={outcome?.usage ?? null} model={outcome?.model ?? null} />
      <RunTrace steps={steps} status={status} />
    </div>
  )
}
