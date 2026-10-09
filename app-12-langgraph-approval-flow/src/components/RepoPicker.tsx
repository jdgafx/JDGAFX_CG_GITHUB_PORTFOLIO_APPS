import { useState, type FormEvent } from 'react'
import { PRESET_REPOS } from '../constants'

interface RepoPickerProps {
  /** The repo whose issues are listed now, as "owner/name", or null before the first load. */
  loaded: string | null
  loading: boolean
  /** True while a run streams, so the list cannot change under it. */
  busy: boolean
  /** Called with the text to load. The page validates it and shows its own message when it is not a repo or an issue. */
  onLoad: (text: string) => void
}

/** The repository controls: one click for a well-known repo, or any public repo or single issue typed in. */
export function RepoPicker({ loaded, loading, busy, onLoad }: RepoPickerProps) {
  const [text, setText] = useState('')
  const disabled = busy || loading

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (text.trim()) onLoad(text)
  }

  return (
    <section className="ds-section" aria-labelledby="repo-heading">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="repo-heading" className="ds-section__title">
          Repository
        </h2>
      </div>

      <div className="gg-presets" role="group" aria-labelledby="presets-label" aria-describedby="presets-help">
        <span id="presets-label" className="ds-label">
          Well-known repos
        </span>
        <div className="gg-presets__row">
          {PRESET_REPOS.map((repo) => (
            <button key={repo} type="button" className="ds-button gg-preset" disabled={disabled} aria-pressed={loaded === repo} onClick={() => onLoad(repo)}>
              {repo}
            </button>
          ))}
        </div>
        <p id="presets-help" className="ds-help">
          Loads the newest open issues, live from GitHub.
        </p>
      </div>

      <form className="gg-repo-form" onSubmit={submit}>
        <div className="ds-field">
          <label htmlFor="repo-text" className="ds-label">
            Any repo or one issue
          </label>
          <input
            id="repo-text"
            className="ds-input"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="owner/name or owner/name#123"
            value={text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            aria-describedby="repo-text-help"
          />
          <p id="repo-text-help" className="ds-help">
            owner/name lists its open issues. owner/name#123 or an issue link loads that one issue, open or closed.
          </p>
        </div>
        <button type="submit" className="ds-button" disabled={disabled || text.trim() === ''} aria-busy={loading}>
          {loading ? 'Loading…' : 'Load'}
        </button>
      </form>
    </section>
  )
}
