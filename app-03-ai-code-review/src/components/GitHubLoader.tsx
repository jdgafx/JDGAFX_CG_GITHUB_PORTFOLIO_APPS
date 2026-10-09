import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { GITHUB_SUGGESTIONS, LANGUAGES } from '../constants'
import { fetchGitHubFile, formatBytes, languageForPath, parseGitHubRef } from '../lib/github'
import type { GitHubFile } from '../lib/github'

interface GitHubLoaderProps {
  /** True while a review runs: loading would swap the code under it. */
  disabled: boolean
  language: string
  /** The file now in the editor, if it came from GitHub. */
  source: GitHubFile | null
  /** The editor text. A load error belongs to the text it was shown over, and goes when that changes. */
  code: string
  /** True once the editor text differs from the loaded file. */
  edited: boolean
  /** `detected` is the review language taken from the file name, or null when it is not recognised. */
  onLoaded: (file: GitHubFile, detected: string | null) => void
}

const languageLabel = (value: string) => LANGUAGES.find((l) => l.value === value)?.label ?? value

/** Suggestions are parsed once, from the same function the input uses, so the card and the fetch cannot disagree. */
const SUGGESTIONS = GITHUB_SUGGESTIONS.flatMap(({ link, blurb }) => {
  const parsed = parseGitHubRef(link)
  return parsed.ok ? [{ link, blurb, ref: parsed.value, language: languageForPath(parsed.value.path) }] : []
})

export function GitHubLoader({ disabled, language, source, code, edited, onLoaded }: GitHubLoaderProps) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<{ message: string; code: string } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const load = async (text: string) => {
    const parsed = parseGitHubRef(text)
    if (!parsed.ok) {
      setFailure({ message: parsed.error, code })
      setNote(null)
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setFailure(null)
    setNote(null)
    try {
      // Only an abort rejects: a newer load or leaving the page. That one has nothing to show.
      const result = await fetchGitHubFile(parsed.value, controller.signal).catch(() => null)
      if (result === null) return
      if (!result.ok) {
        setFailure({ message: result.error, code })
        return
      }
      const detected = languageForPath(result.value.path)
      setNote(
        detected
          ? `Language set to ${languageLabel(detected)} from the file name.`
          : `The file name does not name a language CodeLens offers, so the language stays ${languageLabel(language)}.`,
      )
      onLoaded(result.value, detected)
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setLoading(false)
      }
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    void load(input)
  }

  const handleSuggestion = (link: string) => {
    setInput(link)
    void load(link)
  }

  const error = failure !== null && failure.code === code ? failure.message : null
  const locked = disabled || loading

  return (
    <div className="ds-field gh">
      <label className="ds-label" htmlFor="github-input">
        Load from GitHub
      </label>
      <form className="gh__form" onSubmit={handleSubmit}>
        <input
          id="github-input"
          className="ds-input ds-mono"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="owner/repo/path or a github.com file link"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-describedby="github-help"
          aria-invalid={error !== null}
        />
        <button type="submit" className="ds-button" disabled={locked || !input.trim()} aria-busy={loading}>
          {loading ? 'Loading…' : 'Load file'}
        </button>
      </form>
      <p id="github-help" className="ds-help">
        Paste a file link, or owner/repo/path for the default branch. The file is fetched in your browser, and GitHub
        allows 60 such requests an hour per address.
      </p>

      {error && (
        <p role="alert" className="ds-notice ds-notice--error">
          {error}
        </p>
      )}

      <details className="gh__suggest" open={source === null}>
        <summary className="gh__summary">Or start from a real file</summary>
        <p className="ds-hint" id="github-suggest-help">
          Each one is fetched from GitHub when you choose it.
        </p>
        <ul className="gh__list" aria-describedby="github-suggest-help">
          {SUGGESTIONS.map(({ link, blurb, ref, language: lang }) => (
            <li key={link}>
              <button type="button" className="gh__pick" disabled={locked} onClick={() => handleSuggestion(link)}>
                <span className="gh__pick-file">{ref.path.slice(ref.path.lastIndexOf('/') + 1)}</span>
                <span className="gh__pick-meta">
                  {`${ref.owner}/${ref.repo}`}
                  {ref.ref ? ` · ${ref.ref}` : ''}
                  {lang ? ` · ${languageLabel(lang)}` : ''}
                </span>
                <span className="gh__pick-blurb">{blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>

      {source && (
        <section className="gh__source" aria-label="Loaded file">
          <dl className="gh__facts">
            <div>
              <dt>Repository</dt>
              <dd className="ds-mono">{`${source.owner}/${source.repo}`}</dd>
            </div>
            <div>
              <dt>{source.ref ? 'Branch, tag or commit' : 'Version'}</dt>
              <dd className="ds-mono">{source.ref ?? `default branch, blob ${source.sha.slice(0, 7)}`}</dd>
            </div>
            <div className="gh__facts-wide">
              <dt>Path</dt>
              <dd className="ds-mono">{source.path}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{`${formatBytes(source.size)}, ${source.text.split('\n').length.toLocaleString('en-US')} lines`}</dd>
            </div>
            <div className="gh__facts-end">
              <a className="gh__link" href={source.url} target="_blank" rel="noopener noreferrer">
                Open on GitHub
              </a>
            </div>
          </dl>
          {note && <p className="ds-help">{note}</p>}
          {edited && (
            <p className="ds-help" role="status">
              Edited since loading. Line numbers in a review follow the editor, not the file on GitHub.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
