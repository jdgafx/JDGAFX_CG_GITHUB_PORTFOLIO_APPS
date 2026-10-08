import { formatCount, formatMs, formatUsd, type StageState, type TraceLine, type TraceStatus } from '../lib/run'
import StateMark from './StateMark'

const STATE_OF: Record<TraceStatus, StageState> = {
  ok: 'done',
  failed: 'failed',
  skipped: 'skipped',
  running: 'running',
}

interface RunTraceProps {
  lines: TraceLine[]
}

export default function RunTrace({ lines }: RunTraceProps) {
  return (
    <section className="ds-section" aria-labelledby="trace-title">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="trace-title">Run trace</h2>
        <p className="ds-section__sub">
          One numbered line per model call. Retries are labelled, and stages that did not run are marked skipped.
        </p>
      </div>

      {lines.length === 0 ? (
        <div className="ds-empty">Each model call appears here as it finishes. Press Generate to make the first one.</div>
      ) : (
        <ol className="ds-trace" aria-label="Run trace">
          {lines.map(line => (
            <li key={line.key} className={line.status === 'running' ? 'ds-trace__step ds-trace__step--running' : 'ds-trace__step'}>
              <span className="ds-trace__index">{line.index}</span>
              <div className="trace-body">
                <div className="ds-trace__name">{line.name}</div>
                <div className="ds-trace__detail">{line.detail}</div>
                {line.share > 0 && (
                  <div className="ds-trace__bar" style={{ width: `${line.share}%` }} aria-hidden="true" />
                )}
              </div>
              <div className="ds-trace__meta">
                <StateMark state={STATE_OF[line.status]} />
                {line.status !== 'skipped' && line.status !== 'running' && (
                  <>
                    <div>{formatMs(line.ms)}</div>
                    <div>{line.tokens === undefined ? 'tokens not reported' : `${formatCount(line.tokens)} tokens`}</div>
                    <div>{line.cost === undefined ? 'cost not reported' : formatUsd(line.cost)}</div>
                    <div className="ds-mono trace-model">{line.model ?? 'model not reported'}</div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
