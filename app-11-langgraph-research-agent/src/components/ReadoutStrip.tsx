import { useEffect, useState } from 'react'
import { costHint, count, milliseconds, shortModel, usd } from '../lib/format'
import type { RunView } from '../lib/runState'

interface CellProps {
  label: string
  hint: string
  children: React.ReactNode
  mono?: boolean
}

function Cell({ label, hint, children, mono = true }: CellProps) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className="ds-strip__value" style={mono ? undefined : { fontSize: 15 }}>
        {children}
      </dd>
      <dd className="ds-strip__hint">{hint}</dd>
    </div>
  )
}

/** Counts up from zero while it is on screen, so mounting it starts the clock. */
function LiveClock() {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const id = window.setInterval(() => setElapsed(Date.now() - start), 100)
    return () => window.clearInterval(id)
  }, [])
  return <>{milliseconds(Math.round(elapsed / 100) * 100)}</>
}

interface ReadoutStripProps {
  view: RunView
}

/** Live figures while the run is going, the run's own totals once the answer is ready, dashes before a run. */
export function ReadoutStrip({ view }: ReadoutStripProps) {
  const { result, phase, trace } = view
  const totals = result?.totals
  const running = phase === 'running'
  const ended = phase === 'failed' || phase === 'stopped'
  const none = '—'

  // A resumed run's figures are its own: the kept steps belong to the original run.
  const own = trace.filter((entry) => !entry.reused && !entry.edited)
  const spentMs = own.reduce((sum, entry) => sum + (entry.ms ?? 0), 0)
  const spentTokens = own.reduce((sum, entry) => sum + (entry.usage?.total_tokens ?? 0), 0)
  const priced = own.filter((entry) => entry.cost !== undefined)
  const spentCost = priced.reduce((sum, entry) => sum + (entry.cost ?? 0), 0)
  const current = trace.find((entry) => entry.status === 'running')
  const usedModels = Array.from(new Set(trace.map((entry) => entry.servedModel ?? entry.model ?? '').filter(Boolean)))
  // Before any step has finished there is nothing to show but dashes.
  const soFar = (running || ended) && own.some((entry) => entry.ms !== undefined)
  // A re-run that ended before any step of its own finished has no step time, so the client clock gives the elapsed time.
  const resumed = trace.some((entry) => entry.reused || entry.edited)
  const elapsed = resumed && view.startedAt !== null && view.endedAt !== null ? view.endedAt - view.startedAt : null
  const sofarHint = running ? 'So far' : phase === 'failed' ? 'Before it failed' : 'Before it stopped'

  let tone = ''
  if (running) tone = ' ds-strip--live'
  else if (!result && !soFar) tone = ' ds-strip--pending'

  const chips = (ids: string[]) => (
    <span className="ds-chips">
      {ids.map((id) => (
        <span key={id} className="ds-chip" title={id}>
          {shortModel(id)}
        </span>
      ))}
    </span>
  )

  return (
    <section className="ds-section ds-run__readout" aria-label="Run totals">
      <dl className={`ds-strip${tone}`}>
        <Cell label="Time" hint={running ? 'Running now' : (soFar || elapsed !== null) && !result ? sofarHint : result?.fork ? 'The re-run only' : 'Start to answer'}>
          {running ? <LiveClock /> : totals ? milliseconds(totals.ms) : elapsed !== null ? milliseconds(elapsed) : soFar ? milliseconds(spentMs) : none}
        </Cell>
        <Cell label="Tokens" hint={soFar && !result ? sofarHint : 'All model calls'}>
          {totals
            ? totals.tokens === undefined
              ? 'not reported'
              : count(totals.tokens)
            : soFar && spentTokens > 0
              ? count(spentTokens)
              : none}
        </Cell>
        <Cell label="Cost (USD)" hint={totals ? costHint(totals) : soFar ? sofarHint : 'Reported or estimated'}>
          {totals
            ? totals.cost === undefined
              ? 'not reported'
              : usd(totals.cost)
            : soFar && priced.length > 0
              ? usd(spentCost)
              : none}
        </Cell>
        {running ? (
          <Cell label="Step" hint="Current step" mono={false}>
            <span className="ds-chips">
              <span className="ds-chip ds-chip--live">
                {current ? `${current.node}, visit ${current.visit}` : 'starting'}
              </span>
            </span>
          </Cell>
        ) : (
          <Cell label="Models" hint="Named in the provider replies" mono={false}>
            {result
              ? result.models.length > 0
                ? chips(result.models)
                : 'not reported'
              : soFar && usedModels.length > 0
                ? chips(usedModels)
                : none}
          </Cell>
        )}
      </dl>
    </section>
  )
}
