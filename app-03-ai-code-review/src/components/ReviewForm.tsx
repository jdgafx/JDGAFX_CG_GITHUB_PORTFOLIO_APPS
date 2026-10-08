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
    <section className="ds-card" aria-labelledby="code-title">
      <div className="ds-card__head">
        <h2 id="code-title" className="ds-card__title">
          Code
        </h2>
        <span className="ds-hint">
          code.{getFileExt(language)}, {lineCount.toLocaleString('en-US')} {lineCount === 1 ? 'line' : 'lines'}
        </span>
      </div>

      <div className="ds-stack">
        <p className="ds-hint">Paste code in any language. Each comment names a line, a severity and a suggested change.</p>

        <div className="ds-row">
          <div className="ds-field field-narrow">
            <label className="ds-label" htmlFor="language-select">
              Language
            </label>
            <select
              id="language-select"
              className="ds-select"
              value={language}
              onChange={(e) => onLanguageChange(e.target.value)}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="ds-button" onClick={onSample} disabled={isRunning}>
            Load sample
          </button>
          <button type="button" className="ds-button" onClick={onClear} disabled={isRunning || !code}>
            Clear
          </button>
        </div>

        <CodeEditor
          code={code}
          highlightedLine={highlightedLine}
          textareaRef={textareaRef}
          lineNumbersRef={lineNumbersRef}
          onChange={onCodeChange}
          onSubmit={onReview}
        />

        {isOverLimit && (
          <p role="alert" className="ds-notice ds-notice--error">
            {OVER_LIMIT_MESSAGE}. Remove {(code.length - MAX_CODE_LENGTH).toLocaleString('en-US')} characters to
            review it.
          </p>
        )}

        <div className="ds-row">
          <button type="button" className="ds-button ds-button--primary" onClick={onReview} disabled={!canReview}>
            {isRunning ? 'Reviewing…' : 'Review code'}
          </button>
          {isRunning && (
            <button type="button" className="ds-button" onClick={onCancel}>
              Cancel review
            </button>
          )}
          <span className="ds-hint">Ctrl or Cmd+Enter also runs the review.</span>
        </div>
      </div>
    </section>
  )
}
