import type { ReactNode } from 'react'
import { GITHUB_SUGGESTIONS, LANGUAGES } from '../constants'
import { fetchGitHubFile, formatBytes, languageForPath, parseGitHubRef, type GitHubFile } from '../lib/github'
import { SourceLoader, type Suggestion } from './SourceLoader'

const languageLabel = (value: string) => LANGUAGES.find((l) => l.value === value)?.label ?? value

/** Suggestions are parsed once, from the same function the input uses, so the card and the fetch cannot disagree. */
const SUGGESTIONS: Suggestion[] = GITHUB_SUGGESTIONS.flatMap(({ link, blurb }) => {
  const parsed = parseGitHubRef(link)
  if (!parsed.ok) return []
  const { owner, repo, ref, path } = parsed.value
  const lang = languageForPath(path)
  return [{ link, blurb, title: path.slice(path.lastIndexOf('/') + 1), meta: `${owner}/${repo}${ref ? ` at ${ref}` : ''}${lang ? `, ${languageLabel(lang)}` : ''}` }]
})

interface FileSourceProps {
  language: string
  code: string
  source: GitHubFile | null
  edited: boolean
  disabled: boolean
  onLanguageChange: (value: string) => void
  /** `detected` is the review language taken from the file name, or null when it is not recognised. */
  onLoaded: (file: GitHubFile, detected: string | null) => void
  collapseKey: number
  onFailure: () => void
  fill: { link: string } | null
  children: ReactNode
}

export function FileSource({ language, code, source, edited, disabled, onLanguageChange, onLoaded, collapseKey, onFailure, fill, children }: FileSourceProps) {
  return (
    <SourceLoader
      collapseKey={collapseKey}
      fill={fill}
      onFailure={onFailure}
      id="file"
      label="Public GitHub file"
      placeholder="owner/repo/path or a file link"
      help="Or paste code into the editor. A file is fetched in your browser; GitHub allows 60 such requests an hour per address."
      action="Load file"
      examplesLabel="Real files to try"
      parse={parseGitHubRef}
      load={fetchGitHubFile}
      onLoaded={(file) => {
        const detected = languageForPath(file.path)
        onLoaded(file, detected)
        return detected
          ? `Language set to ${languageLabel(detected)} from the file name.`
          : `The file name does not name a language CodeLens offers, so the language stays ${languageLabel(language)}.`
      }}
      suggestions={SUGGESTIONS}
      disabled={disabled}
      scope={code}
      fields={
        <div className="ds-field">
          <label className="ds-label" htmlFor="language-select">
            Language
          </label>
          <select id="language-select" className="ds-select" value={language} onChange={(e) => onLanguageChange(e.target.value)}>
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>
      }
      loaded={
        source && (
          <section className="ds-section" aria-label="Loaded file">
            <dl className="ds-kv">
              <dt>Repository</dt>
              <dd>{`${source.owner}/${source.repo}`}</dd>
              <dt>Version</dt>
              <dd>{source.ref ?? `default branch, blob ${source.sha.slice(0, 7)}`}</dd>
              <dt>Path</dt>
              <dd>{source.path}</dd>
              <dt>Size</dt>
              <dd>{`${formatBytes(source.size)}, ${source.text.split('\n').length.toLocaleString('en-US')} lines`}</dd>
            </dl>
            <a className="source-link" href={source.url} target="_blank" rel="noopener noreferrer">
              Open on GitHub
            </a>
            {edited && (
              <p className="ds-help" role="status">
                Edited since loading. Line numbers in a review follow the editor, not the file on GitHub.
              </p>
            )}
          </section>
        )
      }
    >
      {children}
    </SourceLoader>
  )
}
