import type { RefObject } from 'react'
import { LANGUAGES, getFileExt } from '../constants'
import { MAX_CODE_LENGTH, OVER_LIMIT_MESSAGE } from '../lib/limits'
import type { RunPhase } from '../types'
import { CodeEditor } from './CodeEditor'

interface ReviewFormProps {
  code: string
  language: string
  phase: RunPhase
  highlightedLine: number | null
  textareaRef: RefObject<HTMLTextAreaElement | null>
  lineNumbersRef: RefObject<HTMLDivElement | null>
  onCodeChange: (value: string) => void
  onLanguageChange: (value: string) => void
  onReview: () => void
  onCancel: () => void
  onSample: () => void
  onClear: () => void
}

export function ReviewForm({
  code,
  language,
  phase,
  highlightedLine,
  textareaRef,
  lineNumbersRef,
  onCodeChange,
  onLanguageChange,
  onReview,
  onCancel,
  onSample,
  onClear,
}: ReviewFormProps) {
  const isRunning = phase === 'running'
  const lineCount = code.split('\n').length
  const isOverLimit = code.length > MAX_CODE_LENGTH
  const canReview = !isRunning && code.trim().length > 0 && !isOverLimit

  return (
    <section className="ds-controls" aria-labelledby="code-title">
      <div className="ds-section">
        <div className="ds-section__head">
          <h2 id="code-title" className="ds-section__title">
            Code
          </h2>
          <p className="ds-section__sub">The snippet to review, and the language it is written in.</p>
        </div>

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
          fileLabel={`code.${getFileExt(language)}`}
          lineCount={lineCount}
          highlightedLine={highlightedLine}
          textareaRef={textareaRef}
          lineNumbersRef={lineNumbersRef}
          onChange={onCodeChange}
          onSubmit={onReview}
        />

        {isOverLimit && (
          <p role="alert" className="ds-notice ds-notice--error">
            {OVER_LIMIT_MESSAGE}. Remove {(code.length - MAX_CODE_LENGTH).toLocaleString('en-US')} characters to review
            it.
          </p>
        )}

        <div className="ds-field">
          <div className="ds-row">
            <button
              type="button"
              className="ds-button"
              onClick={onSample}
              disabled={isRunning}
              aria-describedby="sample-help"
            >
              Load sample
            </button>
            <button type="button" className="ds-button" onClick={onClear} disabled={isRunning || !code}>
              Clear
            </button>
          </div>
          <p id="sample-help" className="ds-help">
            Fills the editor with a snippet that has known problems. Clear empties it.
          </p>
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
