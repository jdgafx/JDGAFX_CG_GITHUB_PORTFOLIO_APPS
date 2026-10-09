import { formatCount, formatMs, formatUsd, lanesFor, type TraceLine, type TraceStatus } from '../lib/run'

const STATE: Record<TraceStatus, { word: string; dot: string; tone: string; row: string }> = {
  ok: { word: 'Finished', dot: 'ds-dot--ok', tone: 'ds-trace__state--ok', row: '' },
  failed: { word: 'Failed', dot: 'ds-dot--failed', tone: 'ds-trace__state--failed', row: ' ds-trace__step--failed' },
  skipped: { word: 'Skipped', dot: 'ds-dot--skipped', tone: '', row: '' },
  running: { word: 'Running', dot: 'ds-dot--running', tone: 'ds-trace__state--running', row: ' ds-trace__step--running' },
}

function shortModel(id: string): string {
  return id.slice(id.indexOf('/') + 1)
}

export default function RunTrace({ lines }: { lines: TraceLine[] }) {
  const lanes = lanesFor(lines)
  return (
    <section className="ds-section ds-run__trace" aria-labelledby="trace-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 className="ds-section__title" id="trace-title">Run trace</h2>
        <p className="ds-section__sub">Bars show when each call ran. A retry is labelled.</p>
      </div>
      {lines.length === 0 ? (
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">No calls yet</p>
          <p className="ds-state__body">Generate to see each call, how long it took, and the tokens, cost and model it used.</p>
        </div>
      ) : (
        <ol className="ds-trace" aria-label="Run trace">
          {lines.map((line, i) => {
            const state = STATE[line.status]
            const lane = lanes[i]
            return (
              <li key={line.key} className={`ds-trace__step${state.row}`}>
                <span className="ds-trace__index">{line.index}</span>
                <div>
                  <div className="ds-trace__head">
                    <span className="ds-trace__name">{line.name}</span>
                    <span className={`ds-trace__state ${state.tone}`.trim()}>
                      <span className={`ds-dot ${state.dot}`} aria-hidden="true" />
                      {state.word}
                    </span>
                  </div>
                  <div className="ds-trace__detail">{line.detail}</div>
                </div>
                <div className="ds-trace__meta">
                  {line.status !== 'skipped' && line.status !== 'running' && (
                    <>
                      <span>{formatMs(line.ms)}</span>
                      {line.stage === 'sources' ? <span>live lookup, no model</span> : (
                        <>
                          <span>{line.tokens === undefined ? 'tokens not reported' : `${formatCount(line.tokens)} tok`}</span>
                          <span>{line.cost === undefined ? 'cost not reported' : formatUsd(line.cost)}</span>
                          {line.model && <span className="ds-chip" title={line.model}>{shortModel(line.model)}</span>}
                        </>
                      )}
                    </>
                  )}
                </div>
                {lane && (
                  <div className="ds-trace__lane" aria-hidden="true">
                    <div className={line.status === 'running' ? 'ds-trace__bar ds-trace__bar--live' : 'ds-trace__bar'} style={{ left: `${lane.left}%`, width: `${lane.width}%` }} />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
