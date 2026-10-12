import { forwardRef } from 'react'
import { markedRuns, preLines } from '../lib/precheck'
import { VERDICT_VIEW } from '../lib/verdict'
import type { AuditClaim, Source } from '../types'
import { Markdown } from './Markdown'
import { VerdictBadge } from './VerdictMark'

interface SourcePanelProps {
  claim: AuditClaim
  sources: Source[]
}

const hasQuote = (claim: AuditClaim, n: number) => (claim.quotes ?? []).some(quote => quote.n === n)

/** One cited source's extract, with the verified quote marked when this source holds it. */
function Extract({ source, claim }: { source: Source; claim: AuditClaim }) {
  const quotes = (claim.quotes ?? []).filter(quote => quote.n === source.n)
  return (
    <article className="panel__source" aria-label={`Source ${source.n}`}>
      <h4 className="panel__source-title">
        <span className="ds-cite__n">[{source.n}]</span>
        <a href={source.url} target="_blank" rel="noreferrer noopener">
          {source.title}
        </a>
        <span className="ds-hint">{quotes.length > 0 ? (quotes.length === 1 ? 'quoted text marked' : 'quoted texts marked') : source.site}</span>
      </h4>
      <p className="panel__text" lang="en">
        {markedRuns(source.snippet, quotes).map((run, i) =>
          run.hit ? (
            <mark key={i} className="quote">
              {run.text}
            </mark>
          ) : (
            <span key={i}>{run.text}</span>
          ),
        )}
      </p>
      {source.note && <p className="ds-hint">{source.note}</p>}
    </article>
  )
}

/** The source behind one claim: the verdict and why, the pre-pass, and each cited extract with the quote marked. */
export const SourcePanel = forwardRef<HTMLDivElement, SourcePanelProps>(function SourcePanel({ claim, sources }, ref) {
  const cited = claim.cites
    .map(n => sources.find(source => source.n === n))
    .filter((source): source is Source => source !== undefined)
    .sort((a, b) => Number(hasQuote(claim, b.n)) - Number(hasQuote(claim, a.n)))

  return (
    <div className="panel" ref={ref} role="region" aria-label="Source text" aria-live="polite">
      <h3 className="panel__title" tabIndex={-1} data-panel-focus>
        Claim {claim.id}
        <VerdictBadge verdict={claim.verdict} />
      </h3>
      <blockquote className="panel__claim">
        <Markdown text={claim.text.replace(/\s*\[\d+(?:\s*[,;]\s*\d+)*\]/g, '')} />
      </blockquote>
      <p className="panel__reason">{claim.reason}</p>
      {claim.uncovered && (
        <p className="ds-help">
          <strong>Not covered by the source:</strong> {claim.uncovered}
        </p>
      )}
      {claim.verdict === 'unsupported' && cited.length > 0 && (
        <p className="ds-notice ds-notice--error">No sentence of the cited {cited.length === 1 ? 'source' : 'sources'} backs this claim. The extract{cited.length === 1 ? '' : 's'} below {cited.length === 1 ? 'is' : 'are'} what the audit read.</p>
      )}
      {claim.verdict !== 'supported' && cited.some(source => source.snippet.endsWith('\u2026')) && (
        <p className="ds-help">An extract is cut at 500 characters, so the article may say more than the audit could read.</p>
      )}
      {claim.verdict === 'partly' && (claim.quotes?.length ?? 0) > 0 && <p className="ds-help">The marked text is the closest the source gets. The rest of the claim is not stated there.</p>}
      {cited.length === 0 ? (
        <p className="ds-notice">This claim cites a source that is not in the list, so there is no text to show.</p>
      ) : (
        cited.map(source => <Extract key={source.n} source={source} claim={claim} />)
      )}
      <dl className="ds-kv panel__pre" aria-label="Pre-check, computed without the model">
        {preLines(claim).map(line => (
          <div key={line.label} className="panel__pre-row" data-ok={line.ok}>
            <dt>{line.label}</dt>
            <dd>{line.value}</dd>
          </div>
        ))}
      </dl>
      <p className="ds-hint">
        {VERDICT_VIEW[claim.verdict].word}. The pre-check counts words, numbers and names without the model. The verdict and the quoted text come from the model; a quote is marked only because it was found word for word in the source, and a supported verdict whose quote was not found there is shown as unverified.
      </p>
    </div>
  )
})
