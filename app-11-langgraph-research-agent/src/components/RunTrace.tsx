import { costSourceText, milliseconds, plural, usd } from '../lib/format'
import type { RunView, TraceEntry } from '../lib/runState'

const STATUS: Record<TraceEntry['status'], { word: string; dot: string; tone: string }> = {
  running: { word: 'Running', dot: 'ds-dot--running', tone: 'trace-state--running' },
  ok: { word: 'Finished', dot: 'ds-dot--ok', tone: 'trace-state--ok' },
  failed: { word: 'Failed', dot: 'ds-dot--failed', tone: 'trace-state--failed' },
  skipped: { word: 'Skipped', dot: 'ds-dot--skipped', tone: '' },
  stopped: { word: 'Stopped', dot: 'ds-dot--stopped', tone: 'trace-state--stopped' },
}

function ModelLine({ entry }: { entry: TraceEntry }) {
  if (entry.servedModel) {
    return (
      <>
        served by <span className="ds-mono">{entry.servedModel}</span>
      </>
    )
  }
  if (entry.model) {
    return (
      <>
        asked for <span className="ds-mono">{entry.model}</span>, served model not reported
      </>
    )
  }
  return <>no model call</>
}

function costLine(entry: TraceEntry): string {
  if (entry.cost === undefined) return 'cost not reported'
  return `${usd(entry.cost)} (${entry.costSource ? costSourceText[entry.costSource] : 'cost'})`
}

interface TraceRowProps {
  index: number
  entry: TraceEntry
  totalMs: number
}

function TraceRow({ index, entry, totalMs }: TraceRowProps) {
  const status = STATUS[entry.status]
  const share = entry.ms !== undefined && totalMs > 0 ? Math.max(2, Math.round((entry.ms / totalMs) * 100)) : 0
  const tokens = entry.usage?.total_tokens

  return (
    <li className={entry.status === 'running' ? 'ds-trace__step ds-trace__step--running' : 'ds-trace__step'}>
      <span className="ds-trace__index">{index}</span>
      <div>
        <div className="trace-head">
          <span className="ds-trace__name">{`${entry.node}, visit ${entry.visit}`}</span>
          <span className={`trace-state ${status.tone}`}>
            <span className={`ds-dot ${status.dot}`} aria-hidden="true" />
            {status.word}
          </span>
        </div>
        <div className="ds-trace__detail">{entry.detail}</div>
        {share > 0 && <div className="ds-trace__bar" style={{ width: `${share}%` }} />}
      </div>
      <div className="ds-trace__meta">
        {entry.ms === undefined ? '—' : milliseconds(entry.ms)}
        {entry.model && (
          <div>
            <ModelLine entry={entry} />
          </div>
        )}
        {tokens !== undefined && <div>{plural(tokens, 'token')}</div>}
        {entry.model && <div>{costLine(entry)}</div>}
      </div>
    </li>
  )
}

interface RunTraceProps {
  view: RunView
}

export function RunTrace({ view }: RunTraceProps) {
  const totalMs = view.result?.totals.ms ?? 0
  return (
    <section className="ds-section" aria-labelledby="trace-title">
      <div className="ds-section__head">
        <h2 id="trace-title" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">One row per step, in order. Times are in milliseconds.</p>
      </div>
      {view.trace.length === 0 ? (
        <div className="ds-empty">
          Start research to see each step, how long it took, and the model, tokens and cost it used.
        </div>
      ) : (
        <ol className="ds-trace">
          {view.trace.map((entry, i) => (
            <TraceRow key={entry.key} index={i + 1} entry={entry} totalMs={totalMs} />
          ))}
        </ol>
      )}
    </section>
  )
}
