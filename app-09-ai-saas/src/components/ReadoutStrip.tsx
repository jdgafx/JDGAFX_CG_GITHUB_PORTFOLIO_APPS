import { useEffect, useState, type ReactNode } from 'react'
import { TRACE_STAGES } from '../lib/api'
import { milliseconds, shortModel, usd } from '../lib/format'
import type { InsightRun } from '../lib/insightRun'

const NONE = '—'
const count = (n: number | undefined) => (n === undefined ? 'not reported' : n.toLocaleString('en-US'))

function Cell({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className="ds-strip__value">{children}</dd>
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

/** Live figures while the run goes (the clock ticks, tokens and cost arrive with the stream step), the run's totals once it is done. */
export default function ReadoutStrip({ run }: { run: InsightRun }) {
  const { status, steps, outcome, totalMs } = run
  const running = status === 'running'
  const usage = outcome?.usage ?? null
  const streamStep = steps.find((step) => step.name === 'Stream answer')
  const spentMs = steps.reduce((sum, step) => sum + step.ms, 0)
  const tokens = usage?.total_tokens ?? streamStep?.tokens
  const cost = usage?.cost ?? streamStep?.cost
  const ended = status === 'failed' || status === 'stopped'
  const soFar = (running || ended) && steps.length > 0
  const current = TRACE_STAGES.find((stage) => !steps.some((step) => step.name === stage.name))
  const hintSoFar = running ? 'So far' : status === 'failed' ? 'Before it failed' : 'Before it stopped'
  const done = status === 'done'

  const tone = running ? ' ds-strip--live' : done || soFar ? '' : ' ds-strip--pending'
  const model = outcome?.model ?? null

  return (
    <section className="ds-run__readout" aria-label="Run totals">
      <dl className={`ds-strip${tone}`}>
        <Cell label="Time" hint={running ? 'Running now' : done ? 'Measured on the server' : soFar ? hintSoFar : 'Start to finish'}>
          {running ? <LiveClock /> : done && totalMs !== null ? milliseconds(totalMs) : soFar ? milliseconds(spentMs) : NONE}
        </Cell>
        <Cell label="Tokens" hint={done && usage ? `${count(usage.prompt_tokens)} in, ${count(usage.completion_tokens)} out` : soFar ? hintSoFar : 'Reported by the provider'}>
          {done || soFar ? (tokens === undefined ? (done ? 'not reported' : NONE) : count(tokens)) : NONE}
        </Cell>
        <Cell label="Cost (USD)" hint={done || soFar ? (done ? 'Reported by the provider' : hintSoFar) : 'Reported by the provider'}>
          {done || soFar ? (cost === undefined ? (done ? 'not reported' : NONE) : usd(cost)) : NONE}
        </Cell>
        {running ? (
          <Cell label="Step" hint="Current step">
            <span className="ds-chips">
              <span className="ds-chip ds-chip--live">{current ? current.name : 'finishing'}</span>
            </span>
          </Cell>
        ) : (
          <Cell label="Model" hint="As named in the response">
            {model ? (
              <span className="ds-chips">
                <span className="ds-chip" title={model}>
                  {shortModel(model)}
                </span>
              </span>
            ) : done ? (
              'not reported'
            ) : (
              NONE
            )}
          </Cell>
        )}
      </dl>
    </section>
  )
}
