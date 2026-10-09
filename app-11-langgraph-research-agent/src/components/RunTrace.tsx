import { costSourceText, count, milliseconds, shortModel, usd } from '../lib/format'
import type { CheckpointOffer } from '../../netlify/shared/events'
import type { RunView, TraceEntry } from '../lib/runState'

const STATUS: Record<TraceEntry['status'], { word: string; dot: string; tone: string }> = {
  running: { word: 'Running', dot: 'ds-dot--running', tone: 'ds-trace__state--running' },
  ok: { word: 'Finished', dot: 'ds-dot--ok', tone: 'ds-trace__state--ok' },
  failed: { word: 'Failed', dot: 'ds-dot--failed', tone: 'ds-trace__state--failed' },
  skipped: { word: 'Skipped', dot: 'ds-dot--skipped', tone: '' },
  stopped: { word: 'Stopped', dot: 'ds-dot--stopped', tone: 'ds-trace__state--stopped' },
}

function ModelChip({ entry }: { entry: TraceEntry }) {
  if (entry.servedModel) {
    return (
      <span className="ds-chip" title={`served by ${entry.servedModel}`}>
        {shortModel(entry.servedModel)}
      </span>
    )
  }
  if (entry.model) {
    return (
      <span className="ds-chip ds-chip--muted" title={`asked for ${entry.model}, served model not reported`}>
        {shortModel(entry.model)}, asked
      </span>
    )
  }
  return null
}

function costLine(entry: TraceEntry): string {
  if (entry.cost === undefined) return 'no cost reported'
  return `${usd(entry.cost)}${entry.costSource === 'estimated' ? ' est.' : ''}`
}

function rowClass(entry: TraceEntry): string {
  const { status } = entry
  if (entry.reused) return 'ds-trace__step trace-step--reused'
  if (entry.edited) return 'ds-trace__step trace-step--edited'
  return status === 'running' || status === 'failed' || status === 'stopped'
    ? `ds-trace__step ds-trace__step--${status}`
    : 'ds-trace__step'
}

interface TraceRowProps {
  index: number
  entry: TraceEntry
  /** Where the step started and how long it ran, as a share of the whole run, for the waterfall lane. */
  lane: { left: number; width: number } | null
  /** The saved point at this row, when the visitor can rewind to it. */
  rewind?: CheckpointOffer
  onRewind: (offer: CheckpointOffer) => void
}

function TraceRow({ index, entry, lane, rewind, onRewind }: TraceRowProps) {
  const status = entry.reused
    ? { word: 'Reused', dot: 'ds-dot--skipped', tone: '' }
    : entry.edited
      ? { word: 'Your edit', dot: 'ds-dot--ok', tone: 'ds-trace__state--ok' }
      : STATUS[entry.status]
  const tokens = entry.usage?.total_tokens

  return (
    <li className={rowClass(entry)}>
      <span className="ds-trace__index">{index}</span>
      <div>
        <div className="ds-trace__head">
          <span className="ds-trace__name">{`${entry.node}, visit ${entry.visit}`}</span>
          <span className={`ds-trace__state ${status.tone}`}>
            <span className={`ds-dot ${status.dot}`} aria-hidden="true" />
            {status.word}
          </span>
        </div>
        <div className="ds-trace__detail">{entry.detail}</div>
        {rewind && (
          <button type="button" className="ds-button trace__rewind" onClick={() => onRewind(rewind)}>
            Rewind here and edit
          </button>
        )}
      </div>
      <div className="ds-trace__meta">
        <span>{entry.ms === undefined ? '—' : entry.reused ? `${milliseconds(entry.ms)} (original)` : milliseconds(entry.ms)}</span>
        {tokens !== undefined && <span>{`${count(tokens)} tok`}</span>}
        {entry.model && (
          <span title={entry.costSource ? costSourceText[entry.costSource] : undefined}>{costLine(entry)}</span>
        )}
        <ModelChip entry={entry} />
      </div>
      {lane && (
        <div className="ds-trace__lane" aria-hidden="true">
          <div
            className={entry.status === 'running' ? 'ds-trace__bar ds-trace__bar--live' : entry.reused ? 'ds-trace__bar trace__bar--reused' : 'ds-trace__bar'}
            style={{ left: `${lane.left}%`, width: `${lane.width}%` }}
          />
        </div>
      )}
    </li>
  )
}

/** Lanes for the waterfall: each finished step starts where the one before it ended, on one shared time axis. */
function lanesFor(trace: readonly TraceEntry[], runMs: number): ({ left: number; width: number } | null)[] {
  const spent = trace.reduce((sum, entry) => sum + (entry.ms ?? 0), 0)
  const axis = Math.max(runMs, spent, 1) * (trace.some((entry) => entry.status === 'running') ? 1.15 : 1)
  let at = 0
  return trace.map((entry) => {
    const left = (at / axis) * 100
    at += entry.ms ?? 0
    if (entry.ms === undefined)
      return entry.status === 'running' ? { left, width: Math.max(100 - left, 2) * 0.12 } : null
    return { left, width: Math.max((entry.ms / axis) * 100, 0.8) }
  })
}

interface RunTraceProps {
  view: RunView
  /** The saved points of the original run, offered on the matching rows. */
  offers: CheckpointOffer[]
  onRewind: (offer: CheckpointOffer) => void
}

/** The saved point that sits at this row, from the original run: the plan, and each critic visit that could still be sent back. */
const offerFor = (entry: TraceEntry, offers: CheckpointOffer[]) =>
  offers.find((offer) => offer.kind === entry.node && offer.visit === entry.visit)

export function RunTrace({ view, offers, onRewind }: RunTraceProps) {
  const lanes = lanesFor(view.trace, view.result?.totals.ms ?? 0)
  return (
    <section className="ds-section ds-run__trace" aria-labelledby="trace-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="trace-title" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">
          Bars show when each step ran.
          {view.runId && (
            <>
              {' '}
              Run id <span className="ds-mono">{view.runId}</span>: quote it when you report a problem.
            </>
          )}
        </p>
      </div>
      {view.trace.length === 0 ? (
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">No steps yet</p>
          <p className="ds-state__body">
            Start research to see each step, how long it took, and the model, tokens and cost it used.
          </p>
        </div>
      ) : (
        <ol className="ds-trace">
          {view.trace.map((entry, i) => (
            <TraceRow key={entry.key} index={i + 1} entry={entry} lane={lanes[i]} rewind={offerFor(entry, offers)} onRewind={onRewind} />
          ))}
        </ol>
      )}
    </section>
  )
}
