import { useEffect, useState, type FormEvent } from 'react'
import { searchTitles } from '../lib/wikipedia'

/** Article titles offered as one-click starts. Only the titles are kept here; the text is fetched live on click. */
const SUGGESTED_ARTICLES = ['Photosynthesis', 'Apollo 11', 'Transformer (deep learning)']

/** A search needs this many characters, and waits this long after the last key. */
const MIN_QUERY = 2
const DEBOUNCE_MS = 300

interface WikipediaPickerProps {
  busy: boolean
  onLoad: (title: string) => void
}

interface Found {
  query: string
  titles: string[]
  failed: boolean
}

/** Search box with live title suggestions, plus a few articles to start from. */
export function WikipediaPicker({ busy, onLoad }: WikipediaPickerProps) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Found | null>(null)
  const typed = query.trim()
  const searching = typed.length >= MIN_QUERY

  // The newest keystroke wins: the wait restarts and any search still in flight is cancelled.
  useEffect(() => {
    if (typed.length < MIN_QUERY) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      searchTitles(typed, controller.signal)
        .then(titles => setFound({ query: typed, titles, failed: false }))
        .catch(() => {
          if (!controller.signal.aborted) setFound({ query: typed, titles: [], failed: true })
        })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [typed])

  const current = searching && found?.query === typed ? found : null
  const titles = current?.titles ?? []

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy || typed === '') return
    onLoad(titles[0] ?? typed)
  }

  const status = !searching
    ? ''
    : current === null
      ? 'Searching Wikipedia.'
      : current.failed
        ? 'Suggestions are unavailable right now. Enter still tries the title you typed.'
        : titles.length === 0
          ? 'No article title matches. Enter still tries what you typed.'
          : `${titles.length} suggested ${titles.length === 1 ? 'article' : 'articles'}.`

  return (
    <div className="ds-stack">
      <form className="ds-stack" onSubmit={handleSubmit} role="search">
        <div className="ds-field">
          <label htmlFor="docmind-wiki" className="ds-label">
            Search Wikipedia
          </label>
          <div className="docmind-inline">
            <input
              id="docmind-wiki"
              className="ds-input"
              type="search"
              autoComplete="off"
              placeholder="An article title, such as Volcano"
              value={query}
              disabled={busy}
              aria-describedby="docmind-wiki-help"
              onChange={e => setQuery(e.target.value)}
            />
            <button type="submit" className="ds-button ds-button--primary" disabled={busy || typed === ''}>
              Load
            </button>
          </div>
          <p id="docmind-wiki-help" className="ds-help">
            Fetches the article text live from en.wikipedia.org. Each section becomes a numbered unit you can cite.
          </p>
        </div>
      </form>

      <p className="ds-hint" role="status">
        {status}
      </p>
      {titles.length > 0 && (
        <ul className="docmind-choices" aria-label="Suggested articles for your search">
          {titles.map(title => (
            <li key={title}>
              <button type="button" className="docmind-choice" disabled={busy} onClick={() => onLoad(title)}>
                {title}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ds-stack">
        <p className="ds-label">Or start with one of these</p>
        <ul className="docmind-choices docmind-choices--chips" aria-label="Suggested starting articles">
          {SUGGESTED_ARTICLES.map(title => (
            <li key={title}>
              <button type="button" className="docmind-choice" disabled={busy} onClick={() => onLoad(title)}>
                {title}
              </button>
            </li>
          ))}
        </ul>
        <p className="ds-help">One click fetches the whole article from Wikipedia as it is today.</p>
      </div>
    </div>
  )
}
