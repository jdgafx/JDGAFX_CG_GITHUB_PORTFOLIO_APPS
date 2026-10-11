import { formatCount, formatUsd, sumUsage } from '../lib/usage'
import { milliseconds, shortModel } from '../lib/format'
import type { AuditView } from '../lib/auditState'
import type { ModelCheck, ModelFacts, RunSummary, StageUsage } from '../types'

export type ReadoutState = 'idle' | 'running' | 'done'

interface ReadoutProps {
  state: ReadoutState
  totalMs?: number
  /** True when the run ended before the server's total arrived, so the total is a sum of stage times. */
  totalIsStageSum: boolean
  usage: StageUsage
  model?: ModelFacts
  summary: RunSummary | null
  audit: AuditView
}

/** The one marker a served-model chip carries. A mismatch uses the warning badge; a reply that named no model carries none. */
const MODEL_MARKER: Partial<Record<ModelCheck, { text: string; className: string }>> = {
  match: { text: '· newest', className: 'ds-chip--muted' },
  mismatch: { text: '· not newest', className: 'ds-badge ds-badge--warning' },
  unchecked: { text: '· unchecked', className: 'ds-chip--muted' },
}

/** The served model, or "not reported", then its marker. The full ids stay in the title. */
function ModelChip({ facts }: { facts: ModelFacts }) {
  const { servedModel, newestModel, modelCheck } = facts
  const marker = MODEL_MARKER[modelCheck]
  const title = modelCheck === 'mismatch' ? `${servedModel}, newest: ${newestModel}` : (servedModel ?? undefined)
  return (
    <span className="ds-chip" title={title}>
      {servedModel ? shortModel(servedModel) : 'not reported'}
      {marker && <span className={marker.className}>{marker.text}</span>}
    </span>
  )
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
  const models = [model, audit.result?.model].filter((facts): facts is ModelFacts => facts !== undefined)
  const shown = models.filter((facts, i) => models.findIndex(other => other.servedModel === facts.servedModel && other.modelCheck === facts.modelCheck) === i)
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
          {shown.length > 0 ? (
            <span className="ds-chips">
              {shown.map(facts => (
                <ModelChip key={`${facts.servedModel}|${facts.modelCheck}`} facts={facts} />
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
