import { formatCount, formatUsd, sumUsage } from '../lib/usage'
import { milliseconds, shortModel } from '../lib/format'
import type { AuditView } from '../lib/auditState'
import type { RunSummary, StageUsage } from '../types'

export type ReadoutState = 'idle' | 'running' | 'done'

interface ReadoutProps {
  state: ReadoutState
  totalMs?: number
  /** True when the run ended before the server's total arrived, so the total is a sum of stage times. */
  totalIsStageSum: boolean
  usage: StageUsage
  model?: string
  summary: RunSummary | null
  audit: AuditView
}

function Cell({ label, hint, children, mono = true }: { label: string; hint: string; children: React.ReactNode; mono?: boolean }) {
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

/** The run's figures, plus the audit's once it has run. A figure the provider did not send shows as "not reported". */
export function ReadoutStrip({ state, totalMs, totalIsStageSum, usage, model, summary, audit }: ReadoutProps) {
  const running = state === 'running'
  const auditUsage = audit.result?.usage
  const both = audit.phase === 'done' && auditUsage ? sumUsage([usage, auditUsage]) : usage
  const ms = totalMs === undefined ? undefined : totalMs + (audit.phase === 'done' ? (audit.result?.ms ?? 0) : 0)
  const models = [...new Set([model, audit.result?.model].filter((id): id is string => Boolean(id)))]
  const dash = '—'
  const tone = running ? ' ds-strip--live' : state === 'idle' ? ' ds-strip--pending' : ''
  const withAudit = audit.phase === 'done'
  const auditNote = audit.phase === 'running' ? 'Audit still running' : withAudit ? 'run and audit' : ''

  return (
    <section className="ds-section ds-run__readout" aria-label="Run totals">
      <dl className={`ds-strip${tone}`}>
        <Cell label="Time" hint={running ? 'Running now' : totalIsStageSum ? 'Sum of stage times' : (auditNote || (summary ? 'Measured on the server' : 'Start to report'))}>
          {ms === undefined ? dash : milliseconds(ms)}
        </Cell>
        <Cell label="Tokens" hint={running ? 'Filled in when the run ends' : usage.prompt_tokens !== undefined && usage.completion_tokens !== undefined ? `${formatCount(both.prompt_tokens)} in, ${formatCount(both.completion_tokens)} out` : 'All model calls'}>
          {state === 'idle' || running ? dash : formatCount(both.total_tokens)}
        </Cell>
        <Cell label="Cost (USD)" hint={running ? 'Filled in when the run ends' : both.cost === undefined && state !== 'idle' ? 'The provider sent no cost' : 'Reported by the provider'}>
          {state === 'idle' || running ? dash : formatUsd(both.cost)}
        </Cell>
        <Cell label="Model" hint="Named in the provider replies" mono={false}>
          {models.length > 0 ? (
            <span className="ds-chips">
              {models.map(id => (
                <span key={id} className="ds-chip" title={id}>
                  {shortModel(id)}
                </span>
              ))}
            </span>
          ) : state === 'idle' || running ? (
            dash
          ) : (
            'not reported'
          )}
        </Cell>
      </dl>
    </section>
  )
}
