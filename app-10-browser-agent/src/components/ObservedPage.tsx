import type { ObservedPage as Observed } from '../types'
import { overlapWith } from '../lib/trace'

interface ObservedPageProps {
  observed: Observed | null
  sessionId: string | null
  expectation: string | null
}

export default function ObservedPage({ observed, sessionId, expectation }: ObservedPageProps) {
  const overlap = observed && expectation ? overlapWith(expectation, observed) : null
  const expectedCount = overlap ? overlap.found.length + overlap.missing.length : 0

  return (
    <section className="ds-card" aria-labelledby="observed-heading">
      <div className="ds-card__head">
        <h2 className="ds-card__title" id="observed-heading">Observed page</h2>
        <span className="ds-hint">What the browser saw, not what the plan expected.</span>
      </div>
      <div className="ds-stack">
        <p className="ds-hint">
          {sessionId ? <>Browserbase session <span className="ds-mono">{sessionId}</span></> : 'No browser session yet.'}
        </p>
        {!observed ? (
          <div className="ds-empty">Nothing observed yet. The page appears after the first step finishes.</div>
        ) : (
          <>
            <dl className="bb-facts">
              <div>
                <dt>URL</dt>
                <dd className="ds-mono">{observed.url}</dd>
              </div>
              <div>
                <dt>Title</dt>
                <dd>{observed.title || 'Untitled page'}</dd>
              </div>
              <div>
                <dt>Page text</dt>
                <dd>
                  <pre className="bb-pre">{observed.excerpt || 'The page returned no readable text.'}</pre>
                </dd>
              </div>
            </dl>
            {overlap && expectation && expectedCount > 0 && (
              <div className="ds-stack">
                <p className="ds-hint">Plan expected: {expectation}</p>
                <p>
                  {overlap.found.length} of {expectedCount} expected terms appear on the page
                  {overlap.missing.length > 0 ? `. Not found: ${overlap.missing.join(', ')}.` : '.'}
                </p>
                <p className="ds-hint">Keyword match only. BrowseBot does not judge whether the result is right.</p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
