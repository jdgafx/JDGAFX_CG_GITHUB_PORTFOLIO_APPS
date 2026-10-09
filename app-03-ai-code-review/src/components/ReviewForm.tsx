import type { RefObject } from 'react'
import { LANGUAGES, getFileExt } from '../constants'
import { MAX_CODE_LENGTH, OVER_LIMIT_MESSAGE } from '../lib/limits'
import type { RunPhase } from '../types'
import type { GitHubFile } from '../lib/github'
import { CodeEditor } from './CodeEditor'
import { GitHubLoader } from './GitHubLoader'

interface ReviewFormProps {
  code: string
  language: string
  phase: RunPhase
  highlightedLine: number | null
  /** The GitHub file in the editor, if any. */
  source: GitHubFile | null
  textareaRef: RefObject<HTMLTextAreaElement | null>
  lineNumbersRef: RefObject<HTMLDivElement | null>
  onCodeChange: (value: string) => void
  onLanguageChange: (value: string) => void
  onLoaded: (file: GitHubFile, detected: string | null) => void
  onReview: () => void
  onCancel: () => void
  onClear: () => void
}

export function ReviewForm({
  code,
  language,
  phase,
  highlightedLine,
  source,
  textareaRef,
  lineNumbersRef,
  onCodeChange,
  onLanguageChange,
  onLoaded,
  onReview,
  onCancel,
  onClear,
}: ReviewFormProps) {
  const isRunning = phase === 'running'
  const lineCount = code.split('\n').length
  const overBy = code.length - MAX_CODE_LENGTH
  const isOverLimit = overBy > 0
  const canReview = !isRunning && code.trim().length > 0 && !isOverLimit

  return (
    <section className="ds-controls" aria-labelledby="code-title">
      <div className="ds-section">
        <div className="ds-section__head">
          <h2 id="code-title" className="ds-section__title">
            Code
          </h2>
          <p className="ds-section__sub">Load a public file from GitHub or paste code, then set its language.</p>
        </div>

        <GitHubLoader
          disabled={isRunning}
          language={language}
          source={source}
          code={code}
          edited={source !== null && code !== source.text}
          onLoaded={onLoaded}
        />

        <div className="ds-field">
          <label className="ds-label" htmlFor="language-select">
            Language
          </label>
          <select
            id="language-select"
            className="ds-select field-narrow"
            value={language}
            aria-describedby="language-help"
            onChange={(e) => onLanguageChange(e.target.value)}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
          <p id="language-help" className="ds-help">
            Shapes the review prompt and names the file, such as code.ts.
          </p>
        </div>

        <CodeEditor
          code={code}
          fileLabel={source ? source.path.slice(source.path.lastIndexOf('/') + 1) : `code.${getFileExt(language)}`}
          lineCount={lineCount}
          highlightedLine={highlightedLine}
          textareaRef={textareaRef}
          lineNumbersRef={lineNumbersRef}
          onChange={onCodeChange}
        />

        {isOverLimit && (
          <p role="alert" className="ds-notice ds-notice--error">
            {OVER_LIMIT_MESSAGE}. Remove {overBy.toLocaleString('en-US')} character{overBy === 1 ? '' : 's'} to review it.
          </p>
        )}

        <div className="ds-field">
          <div className="ds-row">
            <button type="button" className="ds-button" onClick={onClear} disabled={isRunning || !code}>
              Clear
            </button>
          </div>
          <p className="ds-help">Clear empties the editor and the review.</p>
        </div>

        <div className="ds-field">
          <div className="ds-row">
            <button
              type="button"
              className="ds-button ds-button--primary"
              onClick={onReview}
              disabled={!canReview}
              aria-busy={isRunning}
            >
              {isRunning ? 'Reviewing…' : 'Review code'}
            </button>
            {isRunning && (
              <button type="button" className="ds-button" onClick={onCancel} aria-describedby="cancel-help">
                Cancel review
              </button>
            )}
          </div>
          <p className="ds-help">Ctrl or Cmd+Enter also runs the review. Reviews are not saved, so a reload clears them.</p>
          {isRunning && (
            <p id="cancel-help" className="ds-help">
              Cancel stops the browser request. The provider may still bill the call.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
