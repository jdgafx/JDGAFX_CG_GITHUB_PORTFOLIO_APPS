import { formatAge } from '../lib/format'
import type { DuplicateCandidate, DuplicateJudgement, DuplicateReport } from '../types'
import { Md } from './Md'

const VERDICT: Record<DuplicateJudgement['verdict'], { word: string; tone: string }> = {
  duplicate: { word: 'Duplicate', tone: 'ds-badge ds-badge--accent' },
  related: { word: 'Related', tone: 'ds-badge' },
  not: { word: 'Not a duplicate', tone: 'ds-badge gg-badge--muted' },
  unverified: { word: 'Not accepted', tone: 'ds-badge ds-badge--warning' },
}

/** GitHub's own words for how a candidate ended, so "closed" is never read as "fixed". */
function stateWord(candidate: DuplicateCandidate): string {
  if (candidate.state === 'open') return 'Open'
  switch (candidate.stateReason) {
    case 'duplicate':
      return 'Closed as a duplicate on GitHub'
    case 'not_planned':
      return 'Closed, not planned'
    case 'completed':
      return 'Closed, completed'
    default:
      return 'Closed'
  }
}

/**
 * The two passages the model quoted, side by side with equal boxes, and the plain statement of what was checked.
 * Shown for duplicate, related and rejected claims, and inside the approval card for the proposed original.
 */
export function Evidence({ judgement, number }: { judgement: DuplicateJudgement; number: number }) {
  if (judgement.issueQuote === '' && judgement.candidateQuote === '') return null
  return (
    <div className="gg-quotes">
      <figure className="gg-quote">
        <figcaption>This issue says</figcaption>
        <blockquote>{judgement.issueQuote || 'No quote given.'}</blockquote>
      </figure>
      <figure className="gg-quote">
        <figcaption>#{number} says</figcaption>
        <blockquote>{judgement.candidateQuote || 'No quote given.'}</blockquote>
      </figure>
      <p className="gg-check-line">
        {judgement.quotesVerified ? (
          <span className="ds-badge ds-badge--success">
            <span className="ds-dot ds-dot--ok" aria-hidden="true" />
            Quotes verified in both issues
          </span>
        ) : (
          <span className="ds-badge ds-badge--warning">
            <span className="ds-dot ds-dot--failed" aria-hidden="true" />
            Not accepted
          </span>
        )}
        <span className="ds-help">
          {judgement.quotesVerified
            ? 'Both passages were found, word for word, in the issue texts the model was given.'
            : `The model called this ${judgement.claimed}, but at least one passage is not in the texts, so the verdict is not accepted.`}
        </span>
      </p>
    </div>
  )
}

function Candidate({ candidate, confirmed }: { candidate: DuplicateCandidate; confirmed: boolean }) {
  const { judgement } = candidate
  const verdict = judgement ? VERDICT[judgement.verdict] : null
  return (
    <li className={confirmed ? 'gg-cand gg-cand--confirmed' : 'gg-cand'}>
      <div className="gg-cand__head">
        <a className="gg-cand__title" href={candidate.htmlUrl} target="_blank" rel="noopener noreferrer">
          <span className="gg-cand__number">#{candidate.number}</span> {candidate.title}
        </a>
        <span className="gg-cand__verdict">
          {confirmed ? (
            <span className="ds-badge ds-badge--accent">
              <span className="ds-dot ds-dot--ok" aria-hidden="true" />
              Proposed original
            </span>
          ) : null}
          {verdict ? <span className={verdict.tone}>{verdict.word}</span> : <span className="ds-badge gg-badge--muted">Not judged</span>}
        </span>
      </div>
      <p className="ds-help gg-cand__meta">
        <span className="gg-score" role="img" aria-label={`Similarity ${candidate.score.toFixed(2)}, bar full at 0.5`}>
          <span style={{ width: `${Math.min(100, Math.round((candidate.score / 0.5) * 100))}%` }} />
        </span>
        <span>
          Similarity <span className="ds-num">{candidate.score.toFixed(2)}</span>
        </span>
        <span>{stateWord(candidate)}</span>
        <span>opened {formatAge(candidate.createdAt)}</span>
      </p>
      {judgement ? (
        <>
          <p className="gg-cand__reason">
            <Md text={judgement.reason} />
          </p>
          <Evidence judgement={judgement} number={candidate.number} />
          {candidate.sharedTerms.length > 0 ? <p className="gg-shared">Shared words: {candidate.sharedTerms.slice(0, 4).join(', ')}</p> : null}
        </>
      ) : null}
    </li>
  )
}

interface DuplicatesCardProps {
  report: DuplicateReport | null
  /** True while the duplicates step is the one running. */
  searching: boolean
}

/** The signature panel: what was searched, the ranked candidates, and the model's verdicts with the quotes that were checked. */
export function DuplicatesCard({ report, searching }: DuplicatesCardProps) {
  if (!report && !searching) return null
  return (
    <section className="ds-section gg-dups" aria-labelledby="dups-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="dups-title" className="ds-section__title">
          Duplicate check
        </h2>
        <p className="ds-section__sub">
          Candidates come from a GitHub search of this repository, open and closed issues. Similarity is the share of rare words two
          issues have in common, from 0 to 1 (the bar is full at 0.5). The model judges the top three. A duplicate counts only when
          both of its quotes are found in the issue texts.
        </p>
      </div>

      {!report ? (
        <div className="ds-state ds-state--loading" role="status">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">Searching for duplicates</p>
          <p className="ds-state__body">Searching GitHub, then asking the model about the best matches.</p>
          <div className="ds-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      ) : (
        <>
          {report.terms.length > 0 ? (
            <p className="gg-terms">
              <span className="ds-help">Searched for:</span>
              {report.terms.map((term) => (
                <span key={term} className="ds-chip">
                  {term}
                </span>
              ))}
            </p>
          ) : null}
          {report.message ? (
            <p className={report.status === 'unavailable' ? 'ds-notice ds-notice--warning' : 'ds-notice'} role="status">
              {report.message}
            </p>
          ) : null}
          {report.candidates.length > 0 ? (
            <ol className="gg-cands" aria-label="Candidates, best first">
              {report.candidates.map((candidate) => (
                <Candidate key={candidate.number} candidate={candidate} confirmed={candidate.number === report.confirmed} />
              ))}
            </ol>
          ) : report.status === 'checked' ? (
            <p className="ds-help">No candidate to show.</p>
          ) : null}
        </>
      )}
    </section>
  )
}
