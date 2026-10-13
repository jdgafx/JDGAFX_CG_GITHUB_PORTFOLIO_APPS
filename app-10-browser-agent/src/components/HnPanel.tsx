import { useState } from 'react'
import { clock } from '../lib/liveData'
import type { FrontPage } from '../lib/useFrontPage'

const PHONE_COUNT = 5

interface HnPanelProps {
  page: FrontPage
  onReload: () => void
}

/** The live front page: read from the official Hacker News API when the page loads, before any run. */
export default function HnPanel({ page, onReload }: HnPanelProps) {
  const [all, setAll] = useState(false)
  const stories = page.status === 'ready' ? page.stories : []
  const badge = page.status === 'ready' ? 'ds-badge--success' : page.status === 'failed' ? 'ds-badge--danger' : ''
  const dot = page.status === 'ready' ? 'ds-dot ds-dot--ok' : page.status === 'failed' ? 'ds-dot ds-dot--failed' : 'ds-dot ds-dot--running'
  const word = page.status === 'ready' ? `Live · fetched ${clock(page.at)}` : page.status === 'failed' ? 'Unavailable' : 'Loading'

  return (
    <section className="hn" aria-labelledby="hn-title" data-state={page.status}>
      <div className="hn__head">
        <h2 className="hn__title" id="hn-title">Hacker News front page</h2>
        <span className={`ds-badge ${badge}`.trim()} role="status">
          <span className={dot} aria-hidden="true" />
          {word}
        </span>
      </div>
      {page.status === 'failed' ? (
        <div className="hn__fail">
          <p>The Hacker News API did not answer, so the list is empty. This does not affect a run.</p>
          <button type="button" className="ds-button" onClick={onReload}>Try again</button>
        </div>
      ) : (
        <ol className="hn__list" data-all={all ? 'true' : undefined} aria-busy={page.status === 'loading'}>
          {page.status === 'loading'
            ? Array.from({ length: PHONE_COUNT }, (_, i) => <li key={i} className="hn__item hn__item--blank" aria-hidden="true"><span className="hn__rank">{i + 1}</span><span className="hn__bar" /></li>)
            : stories.map((story, i) => (
              <li key={story.id} className="hn__item" data-extra={i >= PHONE_COUNT ? 'true' : undefined}>
                <span className="hn__rank ds-mono">{i + 1}</span>
                <div className="hn__story">
                  <a href={story.href} target="_blank" rel="noopener noreferrer" className="hn__link">{story.title}</a>
                  <span className="hn__meta">
                    {story.host ?? 'news.ycombinator.com'} · {story.score.toLocaleString('en-US')} points · {story.comments.toLocaleString('en-US')} comments
                  </span>
                </div>
              </li>
            ))}
        </ol>
      )}
      {page.status === 'ready' && stories.length > PHONE_COUNT ? (
        <button type="button" className="ds-button hn__more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${stories.length}`}
        </button>
      ) : null}
      <p className="ds-help">Read now from the official Hacker News API in your browser, with no model call. Try it sends the agent to read this same page.</p>
    </section>
  )
}
