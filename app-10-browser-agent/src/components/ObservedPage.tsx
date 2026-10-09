import type { ObservedPage as Observed } from '../types'

interface ObservedPageProps {
  observed: Observed | null
  sessionId: string | null
  expectation: string | null
}

/** The page the browser last read, in a browser window: address, title, text, what the plan expected, then the session. */
export default function ObservedPage({ observed, sessionId, expectation }: ObservedPageProps) {
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
              <dt className={observed.region ? 'bb-region' : 'bb-sr-only'}>
                {observed.region ? <>Text of <code>{observed.region}</code>, first 10 matches</> : 'Page text'}
              </dt>
              <dd>
                {/* The text can be longer than its box, so the box takes focus and a keyboard user can scroll it. */}
                <pre className="bb-pre" role="region" aria-label={observed.region ? `Text of ${observed.region}` : 'Page text'} tabIndex={0}>{observed.excerpt || 'The page returned no readable text.'}</pre>
              </dd>
            </div>
          </dl>
          {expectation && (
            <div className="bb-check">
              <p className="ds-help">Plan expected: {expectation}</p>
              <p className="ds-help">BrowseBot shows what the browser observed. It does not judge whether the result is right.</p>
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
