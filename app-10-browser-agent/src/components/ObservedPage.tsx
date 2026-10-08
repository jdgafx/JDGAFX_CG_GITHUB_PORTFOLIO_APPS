import type { ObservedPage as Observed } from '../types'
import { overlapWith } from '../lib/trace'

interface ObservedPageProps {
  observed: Observed | null
  sessionId: string | null
  expectation: string | null
}

/** The page the browser last read, in a browser window: address, title, text, the keyword check, then the session. */
export default function ObservedPage({ observed, sessionId, expectation }: ObservedPageProps) {
  const overlap = observed && expectation ? overlapWith(expectation, observed) : null
  const expectedCount = overlap ? overlap.found.length + overlap.missing.length : 0

  return (
    <section className="bb-window" aria-labelledby="observed-heading">
      <h3 className="bb-subhead" id="observed-heading">Observed page</h3>
      {!observed ? (
        <div className="ds-empty">Nothing observed yet. The page appears after the first step finishes.</div>
      ) : (
        <div className="bb-window__body" aria-live="polite">
          <dl className="bb-facts">
            <div className="bb-address">
              <dt className="bb-sr-only">Address</dt>
              <dd className="bb-address__url">{observed.url}</dd>
            </div>
            <div>
              <dt className="bb-sr-only">Title</dt>
              <dd className="bb-page-title">{observed.title || 'Untitled page'}</dd>
            </div>
            <div>
              <dt className="bb-sr-only">Page text</dt>
              <dd>
                <pre className="bb-pre">{observed.excerpt || 'The page returned no readable text.'}</pre>
              </dd>
            </div>
          </dl>
          {overlap && expectation && expectedCount > 0 && (
            <div className="bb-check">
              <p className="ds-help">Plan expected: {expectation}</p>
              <p>
                {overlap.found.length} of {expectedCount} expected terms appear on the page
                {overlap.missing.length > 0 ? `. Not found: ${overlap.missing.join(', ')}.` : '.'}
              </p>
              <p className="ds-help">Keyword match only. BrowseBot does not judge whether the result is right.</p>
            </div>
          )}
        </div>
      )}
      <p className="ds-help">
        {sessionId ? <>Browserbase session <span className="ds-mono">{sessionId}</span></> : 'No browser session yet.'}
      </p>
    </section>
  )
}
