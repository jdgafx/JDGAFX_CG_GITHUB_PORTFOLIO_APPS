import { useEffect, useRef, useState, type ReactNode } from 'react'
import { reportBody } from '../lib/audit'
import type { AuditView } from '../lib/auditState'
import type { RunPhase } from '../lib/pipeline'
import { wasTruncated } from '../lib/agents'
import { milliseconds, shortModel } from '../lib/format'
import type { AgentState, Source } from '../types'
import { AuditSummary } from './AuditSummary'
import { Markdown } from './Markdown'
import { SourcePanel } from './SourcePanel'

interface StateProps {
  tone: 'empty' | 'loading' | 'error' | 'stopped'
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}

function ReportState({ tone, title, body, action }: StateProps) {
  return (
    <div className={`ds-state ds-state--${tone}`}>
      <span className="ds-state__mark" aria-hidden="true" />
      <p className="ds-state__title" tabIndex={-1} data-result-focus>
        {title}
      </p>
      <p className="ds-state__body">{body}</p>
      {tone === 'loading' && (
        <div className="ds-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      {action && (
        <div className="ds-state__actions">
          <button type="button" className="ds-button" onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      )}
    </div>
  )
}

interface ReportCardProps {
  phase: RunPhase
  synthesizer: AgentState
  sources: Source[]
  error: string | null
  hasSteps: boolean
  audit: AuditView
  onRetryRun: () => void
  onRetryAudit: () => void
  /** Rendered after the source list; the page puts the export group here on a phone. */
  after?: ReactNode
}

/** On a wide screen the source panel sits beside the report; on a narrow one it follows the report and is scrolled to. */
const WIDE = '(min-width: 1000px)'

/** The source list is open on a wide screen and folded on a phone, where the panel shows each source on selection. */
const sourcesOpenAtStart = () => typeof window === 'undefined' || window.matchMedia(WIDE).matches

/** The page's lead: the final report with every cited sentence badged, the audit summary above it and the source panel beside it. */
export function ReportCard({ phase, synthesizer, sources, error, hasSteps, audit, onRetryRun, onRetryAudit, after }: ReportCardProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(sourcesOpenAtStart)
  const panelRef = useRef<HTMLDivElement>(null)
  const lastPhase = useRef(audit.phase)

  // When the audit ends, Stop audit disappears and focus would fall to the page: move it to the audit summary instead.
  useEffect(() => {
    const was = lastPhase.current
    lastPhase.current = audit.phase
    if (was !== 'running' || audit.phase === 'running') return
    if (document.activeElement && document.activeElement !== document.body) return
    document.querySelector<HTMLElement>('[data-audit-focus]')?.focus({ preventScroll: true })
  }, [audit.phase])
  const text = synthesizer.output.trim()

  const select = (id: number) => {
    setSelected(id)
    if (window.matchMedia(WIDE).matches) return
    // On a narrow screen the panel is below the report: bring it into view and move focus to it.
    requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      panel.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' })
      panel.querySelector<HTMLElement>('[data-panel-focus]')?.focus({ preventScroll: true })
    })
  }

  if (!text) {
    return (
      <section className="ds-section ds-run__result" aria-label="Final report" aria-live="polite">
        {phase === 'running' ? (
          <ReportState tone="loading" title="Researching" body="The cited report appears here when the Synthesizer is done, then every cited sentence is audited against its source." />
        ) : phase === 'failed' ? (
          <ReportState
            tone="error"
            title="The run failed"
            body={`${error ?? 'No report was written.'} ${hasSteps ? 'The steps that ran are in the trace.' : 'No step had started.'}`}
            action={{ label: 'Try again', onClick: onRetryRun }}
          />
        ) : phase === 'stopped' ? (
          <ReportState
            tone="stopped"
            title="Run stopped"
            body={`You stopped it before a report was written. ${hasSteps ? 'The steps that finished stay in the trace and the stage outputs.' : 'No step had finished.'}`}
            action={{ label: 'Start again', onClick: onRetryRun }}
          />
        ) : (
          <ReportState
            tone="empty"
            title="No report yet"
            body="Start research to get a report in which every cited sentence is checked against the text of its source."
          />
        )}
      </section>
    )
  }

  const body = reportBody(text)
  const claim = audit.claims.find(candidate => candidate.id === selected) ?? null
  const result = audit.result
  const foot =
    audit.phase === 'done' && result
      ? `Audited by ${result.model ? shortModel(result.model) : 'the model'} in ${milliseconds(result.ms)}${result.retried ? `, retried once after a ${result.retried === 'timeout' ? 'timeout' : result.retried === 'connection' ? 'dropped connection' : 'failed attempt'}` : ''}. The audit reads the extract of each source shown below, not the whole article.`
      : 'The audit reads the extract of each source shown below, not the whole article.'

  return (
    <section className="ds-section ds-run__result" aria-label="Final report" aria-live="polite">
      <div className="ds-lead audit">
        <div className="ds-lead__meta">
          <h2 className="ds-section__title" tabIndex={-1} data-result-focus>
            Final report
          </h2>
          {wasTruncated(synthesizer) && <span className="ds-badge ds-badge--warning">Cut off</span>}
        </div>
        <AuditSummary view={audit} onRetry={onRetryAudit} />
        <div className="audit__body" data-open={claim ? 'true' : undefined}>
          <div className="audit__report">
            {audit.claims.length > 0 && (
              <p className="ds-help audit__hint">Select a badge or a sentence to read the source text behind it.</p>
            )}
            <div className="ds-lead__text report-text">
              <Markdown text={body} sources={sources} audit={audit.claims.length > 0 ? { claims: audit.claims, selected, onSelect: select } : undefined} />
            </div>
          </div>
          {claim && <SourcePanel ref={panelRef} claim={claim} sources={sources} />}
        </div>
        {sources.length === 0 ? (
          <p className="ds-help">No sources were retrieved, so the report cites none.</p>
        ) : (
          <details className="ds-disclosure" open={sourcesOpen} onToggle={event => setSourcesOpen(event.currentTarget.open)}>
            <summary>Sources ({sources.length})</summary>
            <ol className="ds-cite" aria-label="Sources">
              {sources.map(source => (
                <li key={source.n}>
                  <span className="ds-cite__n">{`[${source.n}]`}</span>
                  <a className="ds-cite__title" href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.title}
                  </a>
                  <span className="ds-cite__url">{source.note ? `${source.site}, ${source.note}` : source.site}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
        <p className="ds-lead__foot">{foot}</p>
        {after}
      </div>
    </section>
  )
}
