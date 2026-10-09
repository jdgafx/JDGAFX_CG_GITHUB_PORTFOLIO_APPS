import type { Phase } from '../lib/view'
import type { RunResult } from '../types/frames'

const SUMMARY_EMPTY: Record<Phase, string> = {
  idle: 'Load the sample or paste a document, then analyze it. The summary appears here when the run finishes.',
  running: 'The summary is written once every chunk is extracted and merged.',
  done: 'This run returned no summary.',
  error: 'No summary, because the run failed. The message under the buttons says why.',
  stopped: 'No summary, because the run stopped before it finished.',
}

const COVERAGE_EMPTY: Record<Phase, string> = {
  idle: 'Coverage is checked after the summary is written.',
  running: 'Coverage is checked after the summary is written.',
  done: 'This run returned no coverage check.',
  error: 'Coverage is not checked when the run fails.',
  stopped: 'Coverage is not checked when the run stops early.',
}

/** Plain badges: the signal colour marks the action and the active step, not the citations. */
function ChunkBadges({ chunks }: { chunks: number[] }) {
  return (
    <>
      {chunks.map((id) => (
        <span key={id} className="ds-badge cite">
          Chunk {id}
        </span>
      ))}
    </>
  )
}

export function SummarySection({ result, phase }: { result: RunResult | null; phase: Phase }) {
  return (
    <section className="ds-section" aria-labelledby="summary-title">
      <div className="ds-section__head">
        <h2 id="summary-title" className="ds-section__title">
          Summary
        </h2>
        <p className="ds-section__sub">
          Each point names the chunks it came from. A point without a valid citation shows no badge.
        </p>
      </div>
      <div aria-live="polite">
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
                <p className="summary-entities">{result.entities.join(', ')}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="empty-note">{SUMMARY_EMPTY[phase]}</p>
        )}
      </div>
    </section>
  )
}

function coverageBadge(result: RunResult): { tone: string; text: string } {
  if (result.notice) return { tone: 'ds-badge--warning', text: 'Retry not completed' }
  if (result.retries > 0) return { tone: 'ds-badge--success', text: '1 retry used' }
  return { tone: 'ds-badge--success', text: 'No retry needed' }
}

function CoverageBody({ result }: { result: RunResult }) {
  const { covered, missing } = result.coverage
  const total = covered.length + missing.length
  const badge = coverageBadge(result)
  return (
    <div className="ds-stack">
      <div className="ds-row">
        <p className="coverage-count ds-num">
          {covered.length} of {total} chunks covered
        </p>
        <span className={`ds-badge ${badge.tone}`}>{badge.text}</span>
      </div>
      {result.notice ? (
        <p className="ds-notice coverage-gap" role="status">
          {result.notice}
        </p>
      ) : null}
      {missing.length > 0 ? (
        <p className="ds-notice ds-notice--error coverage-gap" role="alert">
          {result.notice ? 'Still missing' : 'Still missing after the retry'}: {missing.length === 1 ? 'chunk' : 'chunks'}{' '}
          {missing.join(', ')}. The summary above does not cover {missing.length === 1 ? 'it' : 'them'}.
        </p>
      ) : null}
    </div>
  )
}

export function CoverageSection({ result, phase }: { result: RunResult | null; phase: Phase }) {
  return (
    <section className="ds-section" aria-labelledby="coverage-title">
      <div className="ds-section__head">
        <h2 id="coverage-title" className="ds-section__title">
          Coverage
        </h2>
        <p className="ds-section__sub">A chunk counts as covered when it gave key points and the summary cites it.</p>
      </div>
      {result ? <CoverageBody result={result} /> : <p className="empty-note">{COVERAGE_EMPTY[phase]}</p>}
    </section>
  )
}
