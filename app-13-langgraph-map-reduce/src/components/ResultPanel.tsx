import type { RunResult } from '../types/frames'

function ChunkBadges({ chunks }: { chunks: number[] }) {
  if (chunks.length === 0) return null
  return (
    <>
      {chunks.map((id) => (
        <span key={id} className="ds-badge ds-badge--accent cite">
          [chunk {id}]
        </span>
      ))}
    </>
  )
}

export function SummaryCard({ result }: { result: RunResult | null }) {
  return (
    <section className="ds-card" aria-labelledby="summary-title">
      <div className="ds-card__head">
        <h2 id="summary-title" className="ds-card__title">
          Summary
        </h2>
        <span className="ds-hint">points cite the chunks they came from</span>
      </div>
      {result ? (
        <div className="ds-stack">
          <p className="summary-overview">{result.summary.overview}</p>
          {result.summary.sections.map((section) => (
            <div key={section.heading} className="summary-section">
              <h3 className="summary-section__title">{section.heading}</h3>
              <ul className="summary-points">
                {section.points.map((point, i) => (
                  <li key={i}>
                    <span>{point.text}</span> <ChunkBadges chunks={point.chunks} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {result.entities.length > 0 ? (
            <div className="summary-section">
              <h3 className="summary-section__title">Entities across the document</h3>
              <p className="ds-hint">{result.entities.join(', ')}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="ds-empty">The summary appears here when the run finishes.</div>
      )}
    </section>
  )
}

export function CoverageCard({ result }: { result: RunResult | null }) {
  if (!result) {
    return (
      <section className="ds-card" aria-labelledby="coverage-title">
        <h2 id="coverage-title" className="ds-card__title">
          Coverage
        </h2>
        <div className="ds-empty">Coverage is checked after the summary is written.</div>
      </section>
    )
  }
  const { covered, missing } = result.coverage
  const total = covered.length + missing.length
  const badgeTone = result.notice ? 'ds-badge--warning' : 'ds-badge--success'
  const badgeText = result.notice ? 'retry did not finish' : result.retries > 0 ? '1 retry used' : 'no retry needed'
  return (
    <section className="ds-card" aria-labelledby="coverage-title">
      <div className="ds-card__head">
        <h2 id="coverage-title" className="ds-card__title">
          Coverage
        </h2>
        <span className={`ds-badge ${badgeTone}`}>{badgeText}</span>
      </div>
      <p className="coverage-count">
        {covered.length} of {total} chunks covered
      </p>
      <p className="ds-hint">Covered means the chunk produced key points and the summary cites it.</p>
      {result.notice ? (
        <p className="ds-notice coverage-gap" role="status">
          {result.notice}
        </p>
      ) : null}
      {missing.length > 0 ? (
        <p className="ds-notice ds-notice--error coverage-gap" role="alert">
          {result.notice ? 'Still missing' : 'Still missing after the retry'}: chunk {missing.join(', ')}. The summary
          above does not cover {missing.length === 1 ? 'it' : 'them'}.
        </p>
      ) : null}
    </section>
  )
}
