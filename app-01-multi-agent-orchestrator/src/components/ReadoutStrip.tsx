import type { CSSProperties } from 'react'
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
  /** The reply-producing call's model: the Synthesizer's, whose reply is the report shown. */
  model?: ModelFacts
  /** Every model call of the run, stages and audit. The marker shows the worst of their checks. */
  calls: ModelFacts[]
  summary: RunSummary | null
  audit: AuditView
}

/** The marker for each check, as text coloured with the page's own tokens. A reply that named no model carries none. */
const MODEL_MARKER: Partial<Record<ModelCheck, { text: string; style: CSSProperties }>> = {
  match: { text: '· newest', style: { color: 'var(--ds-text-muted)' } },
  mismatch: { text: '· not newest', style: { color: 'var(--ds-warning)', fontWeight: 600 } },
  unchecked: { text: '· unchecked', style: { color: 'var(--ds-text-muted)' } },
}

/** How bad a check is when several calls in one run are compared. */
const CHECK_RANK: Record<ModelCheck, number> = { match: 0, unchecked: 1, 'not-reported': 2, mismatch: 3 }

/** The call with the worst check, the first one when two are equally bad, or undefined when there are no calls. */
function worstCall(calls: ModelFacts[]): ModelFacts | undefined {
  return calls.reduce<ModelFacts | undefined>((worst, call) => (!worst || CHECK_RANK[call.modelCheck] > CHECK_RANK[worst.modelCheck] ? call : worst), undefined)
}

/**
 * The served model of a reply-producing call, or "not reported". The first chip also carries the run's one marker, the worst
 * check across its calls. A mismatch names the mismatching call's served id and the newest in the title.
 */
function ModelChip({ facts, worst }: { facts: ModelFacts; worst?: ModelFacts }) {
  const marker = worst ? MODEL_MARKER[worst.modelCheck] : undefined
  const title = worst?.modelCheck === 'mismatch' ? `${worst.servedModel}, newest: ${worst.newestModel}` : (facts.servedModel ?? undefined)
  return (
    <span className="ds-chip" title={title}>
      {facts.servedModel ? shortModel(facts.servedModel) : 'not reported'}
      {marker && <span style={marker.style}>{marker.text}</span>}
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
export function ReadoutStrip({ state, totalMs, totalIsStageSum, usage, model, calls, summary, audit }: ReadoutProps) {
  const running = state === 'running'
  const auditUsage = audit.result?.usage
  const both = audit.phase === 'done' && auditUsage ? sumUsage([usage, auditUsage]) : usage
  const ms = totalMs === undefined ? undefined : totalMs + (audit.phase === 'done' ? (audit.result?.ms ?? 0) : 0)
  const replies = [model, audit.result?.model].filter((facts): facts is ModelFacts => facts !== undefined)
  const shown = replies.filter((facts, i) => replies.findIndex(other => other.servedModel === facts.servedModel) === i)
  const worst = worstCall(calls)
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
              {shown.map((facts, i) => (
                <ModelChip key={facts.servedModel ?? 'none'} facts={facts} worst={i === 0 ? worst : undefined} />
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
