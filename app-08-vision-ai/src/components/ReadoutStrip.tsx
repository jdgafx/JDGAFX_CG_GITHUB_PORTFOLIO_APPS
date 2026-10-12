import { useEffect, useState } from 'react'
import type { ModelCheck } from '../../netlify/shared/newest-model'
import type { RunSummary, TraceStep } from '../lib/api'
import { NOT_REPORTED, formatCount, formatMs, formatUsd, shortModel } from '../lib/format'
import type { RunStatus } from '../lib/useAnalysis'

interface CellProps {
  label: string
  hint: React.ReactNode
  children: React.ReactNode
  small?: boolean
}

function Cell({ label, hint, children, small = false }: CellProps) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className="ds-strip__value" style={small ? { fontSize: 15 } : undefined}>
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
  return <>{formatMs(Math.round(elapsed / 100) * 100)}</>
}

interface ReadoutStripProps {
  status: RunStatus
  steps: TraceStep[]
  summary: RunSummary | null
}

const NONE = '—'

// The marker in the hint line after the usual text. A check the provider could not support adds nothing.
const MARKS: Record<ModelCheck, { text: string; className?: string } | null> = {
  match: { text: '· newest' },
  mismatch: { text: '· not newest', className: 'ds-badge--warning' },
  unchecked: { text: '· unchecked' },
  'not-reported': null,
}

/** The served id in full; on a mismatch, the newest id beside it. */
function modelTitle(summary: RunSummary): string {
  if (summary.modelCheck === 'mismatch') return `${summary.mismatchedModel}, newest: ${summary.newestModel}`
  return summary.servedModel ?? NOT_REPORTED
}

/** The served model in its chip. Plain text when the reply named no model and nothing mismatched. */
function modelReadout(summary: RunSummary | null) {
  if (!summary) return NONE
  if (!summary.servedModel && summary.modelCheck !== 'mismatch') return NOT_REPORTED
  return (
    <span className="ds-chips">
      <span className="ds-chip" title={modelTitle(summary)}>
        {summary.servedModel ? shortModel(summary.servedModel) : NOT_REPORTED}
      </span>
    </span>
  )
}

/** The hint line: the usual text, then the newest-model marker when the check gave one. */
function modelHint(summary: RunSummary | null) {
  const base = 'Named in the provider reply'
  const mark = summary ? MARKS[summary.modelCheck] : null
  if (!mark) return base
  return (
    <>
      {base}{' '}
      <span className={mark.className}>{mark.text}</span>
    </>
  )
}

/** Live figures while the run is going, the run's own totals once it has ended, dashes before one. */
export default function ReadoutStrip({ status, steps, summary }: ReadoutStripProps) {
  const running = status === 'running'
  const cut = status === 'failed' || status === 'cancelled'
  const current = steps.find(step => step.status === 'running')
  const tone = running ? ' ds-strip--live' : summary ? '' : ' ds-strip--pending'
  const spent = cut ? (status === 'failed' ? 'Before it failed' : 'Before it stopped') : ''
  const usage = summary?.usage
  // When a call of the run never reported, what is shown is a minimum, and it says so.
  const missing = summary?.unreportedCalls ?? 0
  const atLeast = (shown: string) => (missing > 0 && shown !== NOT_REPORTED ? `at least ${shown}` : shown)
  const missingHint = missing > 0 ? `${missing} ${missing === 1 ? 'call' : 'calls'} not reported` : ''
  const tokens = summary ? atLeast(formatCount(usage?.total_tokens)) : NONE
  const cost = summary ? atLeast(formatUsd(usage?.cost)) : NONE

  return (
    <section className="ds-section ds-run__readout" aria-label="Run totals">
      <dl className={`ds-strip${tone}`}>
        <Cell label="Time" hint={running ? 'Running now' : spent || 'Start to answer'}>
          {running ? <LiveClock /> : summary ? formatMs(summary.totalMs) : NONE}
        </Cell>
        <Cell label="Tokens" hint={missingHint || spent || (usage ? `${formatCount(usage.prompt_tokens)} in, ${formatCount(usage.completion_tokens)} out` : 'Prompt plus answer')} small={tokens === NOT_REPORTED}>
          {tokens}
        </Cell>
        <Cell label="Cost (USD)" hint={missingHint || spent || 'As the provider reports it'} small={cost === NOT_REPORTED}>
          {cost}
        </Cell>
        {running ? (
          <Cell label="Step" hint="Current step" small>
            <span className="ds-chips">
              <span className="ds-chip ds-chip--live">{current?.name ?? 'starting'}</span>
            </span>
          </Cell>
        ) : (
          <Cell label="Model" hint={modelHint(summary)} small>
            {modelReadout(summary)}
          </Cell>
        )}
      </dl>
    </section>
  )
}
