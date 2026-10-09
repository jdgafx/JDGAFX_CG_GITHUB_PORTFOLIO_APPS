import { PASS1, PASS2, TOTAL_MS } from '../../netlify/shared/budget'
import { PIPELINE_STAGES } from '../constants'
import { count, milliseconds } from '../lib/format'
import type { RunPhase, RunSummary, StepStatus, TraceStep } from '../types'

const STATUS: Record<StepStatus, { word: string; dot: string; tone: string }> = {
  ok: { word: 'Finished', dot: 'ds-dot--ok', tone: 'ds-trace__state--ok' },
  failed: { word: 'Failed', dot: 'ds-dot--failed', tone: 'ds-trace__state--failed' },
  skipped: { word: 'Skipped', dot: 'ds-dot--skipped', tone: '' },
}

/** Where a step started and how long it ran, as a share of the whole run, for the waterfall lane. */
function lane(step: TraceStep, axis: number): { left: number; width: number } | null {
  if (step.status === 'skipped' || step.at === undefined || axis <= 0) return null
  return { left: Math.min(98, (step.at / axis) * 100), width: Math.max((step.ms / axis) * 100, 0.8) }
}

function TraceRow({ index, step, axis }: { index: number; step: TraceStep; axis: number }) {
  const status = STATUS[step.status]
  const bar = lane(step, axis)
  return (
    <li className={step.status === 'failed' ? 'ds-trace__step ds-trace__step--failed' : 'ds-trace__step'}>
      <span className="ds-trace__index">{index}</span>
      <div>
        <div className="ds-trace__head">
          <span className="ds-trace__name">{step.name}</span>
          <span className={`ds-trace__state ${status.tone}`}>
            <span className={`ds-dot ${status.dot}`} aria-hidden="true" />
            {status.word}
          </span>
        </div>
        <div className="ds-trace__detail">{step.detail}</div>
      </div>
      <div className="ds-trace__meta">
        <span>{step.status === 'skipped' ? 'not run' : milliseconds(step.ms)}</span>
        {step.tokens !== undefined && <span>{`${count(step.tokens)} tok`}</span>}
        {step.cost !== undefined && <span>{`$${step.cost.toFixed(5)}`}</span>}
      </div>
      {bar && (
        <div className="ds-trace__lane" aria-hidden="true">
          <div className="ds-trace__bar" style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />
        </div>
      )}
    </li>
  )
}

export function RunTrace({ phase, summary }: { phase: RunPhase; summary: RunSummary | null }) {
  const steps = summary?.trace ?? []
  const axis = Math.max(summary?.totalMs ?? 0, ...steps.map((s) => (s.at ?? 0) + s.ms), 1)
  return (
    <section className="ds-section ds-run__trace" aria-labelledby="trace-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="trace-title" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">
          Bars show when each stage ran. {`The two model calls share a ${TOTAL_MS / 1000} s budget: pass 1 may take up to ${PASS1.limitMs / 1000} s (healthy p95 ${PASS1.p95 / 1000} s), pass 2 up to ${PASS2.limitMs / 1000} s (healthy p95 ${PASS2.p95 / 1000} s). A timeout or a dropped connection is retried once if the budget allows.`}
        </p>
      </div>
      {steps.length > 0 ? (
        <ol className="ds-trace">
          {steps.map((step, i) => (
            <TraceRow key={`${step.name}-${i}`} index={i + 1} step={step} axis={axis} />
          ))}
        </ol>
      ) : phase === 'failed' ? (
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">No stage reported</p>
          <p className="ds-state__body">The run failed before the server reported any stage.</p>
        </div>
      ) : (
        <>
          <ol className="ds-trace">
            {PIPELINE_STAGES.map((stage, i) => (
              <li key={stage.name} className="ds-trace__step">
                <span className="ds-trace__index">{i + 1}</span>
                <div>
                  <div className="ds-trace__head">
                    <span className="ds-trace__name">{stage.name}</span>
                  </div>
                  <div className="ds-trace__detail">{stage.detail}</div>
                </div>
              </li>
            ))}
          </ol>
          <p className="ds-help">
            {phase === 'running' ? 'The server reports each stage when the run ends.' : 'Start a review to see each stage, how long it took and what it produced.'}
          </p>
        </>
      )}
    </section>
  )
}
