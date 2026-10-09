import { useEffect, useRef, useState, type FormEvent } from 'react'
import { fetchedNow, type WikiFetch } from '../lib/liveData'
import { formatTokens } from '../lib/format'
import { LOADER_MAX_CHARS } from '../lib/limits'
import { SUGGESTED_TITLES, WikiError, type Article } from '../lib/wikipedia'
import { loadArticle, searchTitles } from '../lib/wikipedia-api'

/** Wait this long after the last keystroke before asking Wikipedia for matches. */
const SEARCH_DELAY_MS = 300

type Load =
  | { phase: 'idle' }
  | { phase: 'loading'; title: string }
  | { phase: 'failed'; title: string; error: WikiError; matches: string[] }

interface WikipediaLoaderProps {
  /** The text now in the document box, so the article card only shows while the box still holds it. */
  text: string
  /** True while an analysis runs. The loader cannot change the text then. */
  disabled: boolean
  onLoad: (text: string) => void
  /** What the last fetch did, for the live-data chip. */
  onFetch: (fetched: WikiFetch) => void
  /** Changes when a run completes on a narrow screen: the suggestion list folds away so the result is not pushed down. */
  collapseKey: number
}

export function WikipediaLoader({ text, disabled, onLoad, onFetch, collapseKey }: WikipediaLoaderProps) {
  // Open beside the run on a wide screen, closed on a phone where it would push the run down.
  const [suggestOpen, setSuggestOpen] = useState(() => window.matchMedia('(min-width: 1000px)').matches)
  const [seenKey, setSeenKey] = useState(collapseKey)
  if (seenKey !== collapseKey) {
    setSeenKey(collapseKey)
    setSuggestOpen(false)
  }
  const [query, setQuery] = useState('')
  const [load, setLoad] = useState<Load>({ phase: 'idle' })
  const [article, setArticle] = useState<Article | null>(null)
  const [found, setFound] = useState<{ term: string; titles: string[]; failed: boolean } | null>(null)
  const loading = useRef<AbortController | null>(null)
  const busy = load.phase === 'loading'
  const term = query.trim()
  const searchable = term.length >= 2 && !busy && term !== article?.title
  // Results belong to the words they were fetched for, so stale ones are never shown.
  const result = searchable && found?.term === term ? found : null
  const matches = result?.titles ?? []
  const searchFailed = result?.failed ?? false

  // Matches for what is typed, after a short pause. A newer keystroke cancels the older request.
  useEffect(() => {
    if (!searchable) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchTitles(term, controller.signal).then(
        (titles) => setFound({ term, titles, failed: false }),
        (err: unknown) => {
          if (!controller.signal.aborted) setFound({ term, titles: [], failed: err instanceof WikiError })
        },
      )
    }, SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [term, searchable])

  // Leaving the page cancels a load in flight.
  useEffect(() => () => loading.current?.abort(), [])

  async function fetchArticle(title: string): Promise<void> {
    const wanted = title.trim()
    if (!wanted || busy || disabled) return
    loading.current?.abort()
    const controller = new AbortController()
    loading.current = controller
    setLoad({ phase: 'loading', title: wanted })
    onFetch({ kind: 'loading' })
    try {
      const loaded = await loadArticle(wanted, controller.signal)
      if (controller.signal.aborted) return
      setArticle(loaded)
      setQuery(loaded.title)
      setLoad({ phase: 'idle' })
      onLoad(loaded.text)
      onFetch({ kind: 'loaded', text: loaded.text, at: fetchedNow() })
    } catch (err) {
      if (controller.signal.aborted) return
      onFetch({ kind: 'failed' })
      const error = err instanceof WikiError ? err : new WikiError('network', 'Something went wrong while loading the article. Try again.')
      // A page that does not exist, or only lists others, still has useful neighbours to offer.
      const similar =
        error.kind === 'not_found' || error.kind === 'disambiguation'
          ? await searchTitles(wanted, controller.signal).catch(() => [])
          : []
      if (controller.signal.aborted) return
      setLoad({ phase: 'failed', title: wanted, error, matches: similar.filter((t) => t.toLowerCase() !== wanted.toLowerCase()) })
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    void fetchArticle(query)
  }

  function pick(title: string): void {
    setQuery(title)
    void fetchArticle(title)
  }

  const current = article !== null && article.text === text ? article : null
  const offered = load.phase === 'failed' ? load.matches : matches

  return (
    <div className="ds-panel wiki" role="group" aria-labelledby="wiki-title">
      <div className="ds-field">
        <h3 id="wiki-title" className="ds-label">
          Load a Wikipedia article
        </h3>
        <p id="wiki-help" className="ds-help">
          Type a title or a few words, then press Load. The article is fetched live and fills the box below.
        </p>
        <form className="wiki-form" onSubmit={submit}>
          <input
            id="wiki-query"
            className="ds-input"
            type="search"
            value={query}
            disabled={busy || disabled}
            autoComplete="off"
            spellCheck={false}
            placeholder="For example: Apollo 11"
            aria-label="Article title or search words"
            aria-describedby="wiki-help"
            onChange={(event) => {
              setQuery(event.target.value)
              setLoad({ phase: 'idle' })
            }}
          />
          <button type="submit" className="ds-button" disabled={busy || disabled || query.trim() === ''} aria-busy={busy}>
            {busy ? 'Loading' : 'Load'}
          </button>
        </form>
      </div>

      {offered.length > 0 ? (
        <div className="wiki-block">
          <p className="ds-hint wiki-lead">{load.phase === 'failed' ? 'Did you mean one of these?' : 'Matching articles'}</p>
          <ul className="wiki-list">
            {offered.map((title) => (
              <li key={title}>
                <button type="button" className="wiki-chip" disabled={busy || disabled} onClick={() => pick(title)}>
                  {title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {searchFailed && load.phase !== 'failed' ? (
        <p className="ds-hint">Suggestions are unavailable right now. You can still press Load.</p>
      ) : null}

      <details className="ds-disclosure" open={suggestOpen} onToggle={(event) => setSuggestOpen(event.currentTarget.open)}>
        <summary>Suggested articles, fetched live</summary>
        <ul className="wiki-list">
          {SUGGESTED_TITLES.map((title) => (
            <li key={title}>
              <button type="button" className="wiki-chip" disabled={busy || disabled} onClick={() => pick(title)}>
                {title}
              </button>
            </li>
          ))}
        </ul>
      </details>

      <div className="wiki-state" role="status" aria-live="polite">
        {load.phase === 'loading' ? (
          <p className="wiki-loading">
            <span className="ds-dot ds-dot--running" aria-hidden="true" />
            Loading {load.title} from Wikipedia
          </p>
        ) : null}
        {load.phase === 'failed' ? (
          <div className="ds-notice ds-notice--error wiki-error">
            <p>{load.error.message}</p>
            {load.error.retryable ? (
              <button type="button" className="ds-button wiki-retry" onClick={() => void fetchArticle(load.title)}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {load.phase === 'idle' && current ? (
          <div className="wiki-loaded">
            <p className="wiki-loaded__title">
              <a href={current.url} target="_blank" rel="noreferrer noopener">
                {current.title}
              </a>
              <span className="ds-hint"> on Wikipedia</span>
            </p>
            <p className="ds-hint ds-num">
              {formatTokens(current.text.length)} characters loaded
              {current.trimmed
                ? `. The article has ${formatTokens(current.originalChars)}, so it was cut at a paragraph break to fit the ${formatTokens(LOADER_MAX_CHARS)} loader limit.`
                : '. The whole article fits.'}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
