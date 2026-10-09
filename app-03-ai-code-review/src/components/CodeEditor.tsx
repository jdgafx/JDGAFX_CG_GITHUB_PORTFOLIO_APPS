import type { KeyboardEvent, RefObject, UIEvent } from 'react'
import { editorKey } from '../lib/editorkeys'
import { count } from '../lib/format'
import { MAX_CODE_LENGTH, OVER_LIMIT_MESSAGE } from '../lib/limits'
import type { ReviewComment } from '../types'
import { placeOf } from './Finding'

interface CodeEditorProps {
  code: string
  /** The file name the review refers to, such as code.ts. */
  fileLabel: string
  lineCount: number
  highlightedLine: number | null
  running: boolean
  canReview: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  lineNumbersRef: RefObject<HTMLDivElement | null>
  /** The comment the reader jumped here from, with the way back to it. */
  jump: ReviewComment | null
  /** Commented lines of the reviewed file, by line number: the gutter marks them and links back to the comment. */
  marks: ReadonlyMap<number, ReviewComment>
  onMarkClick: (comment: ReviewComment) => void
  onBack: () => void
  onChange: (value: string) => void
  onReview: () => void
  onClear: () => void
}

export function CodeEditor({ code, fileLabel, lineCount, highlightedLine, running, canReview, textareaRef, lineNumbersRef, jump, marks, onMarkClick, onBack, onChange, onReview, onClear }: CodeEditorProps) {
  const overBy = code.length - MAX_CODE_LENGTH
  const handleScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = editorKey(e.key, e.shiftKey, jump !== null)
    if (action === 'back') {
      e.preventDefault()
      onBack()
    } else if (action === 'indent') {
      e.preventDefault()
      const el = e.currentTarget
      const { selectionStart, selectionEnd } = el
      onChange(`${code.slice(0, selectionStart)}  ${code.slice(selectionEnd)}`)
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = selectionStart + 2
      })
    }
  }

  return (
    <section className="ds-card editor-card" aria-labelledby="code-title">
      <div className="ds-card__head">
        <h2 id="code-title" className="ds-section__title">
          Code to review
        </h2>
        <span className="ds-hint">{`${fileLabel}, ${count(lineCount)} ${lineCount === 1 ? 'line' : 'lines'}`}</span>
      </div>
      {jump && (
        <div className="editor__jump" role="status">
          <p>
            <strong>{`${placeOf(jump)}: ${jump.severity}.`}</strong> {jump.message}
          </p>
          <button type="button" className="ds-button" onClick={onBack}>
            Back to comment
          </button>
        </div>
      )}
      <div className="editor">
        <div className="editor__gutter" ref={lineNumbersRef} role="group" aria-label="Line numbers. A marked number has a review comment.">
          {Array.from({ length: lineCount }, (_, i) => {
            const n = i + 1
            const mark = marks.get(n)
            const cls = n === highlightedLine ? 'editor__num is-active' : 'editor__num'
            return mark ? (
              // A pointer shortcut to the comment; the same jump is on the comment's own button, which is the tab stop.
              <button key={n} type="button" tabIndex={-1} className={`${cls} editor__num--marked`} data-severity={mark.severity} aria-label={`Line ${n}, ${mark.severity} comment. Go to it.`} onClick={() => onMarkClick(mark)}>
                {n}
              </button>
            ) : (
              <span key={n} className={cls} aria-hidden="true">
                {n}
              </span>
            )
          })}
        </div>
        <textarea
          id="code-input"
          ref={textareaRef}
          className="ds-textarea editor__input"
          aria-label="Code to review"
          value={code}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          placeholder={'// Paste code here, or load a file from GitHub.\n// Tab inserts two spaces.'}
          spellCheck={false}
          wrap="off"
          aria-describedby="code-help"
        />
      </div>
      <p id="code-help" className={overBy > 0 ? 'ds-help ds-help--error' : 'ds-help'}>
        {overBy > 0
          ? `${OVER_LIMIT_MESSAGE}. Remove ${count(overBy)} character${overBy === 1 ? '' : 's'} to review it.`
          : `${count(code.length)} of ${count(MAX_CODE_LENGTH)} characters. The reviewer reads it as a numbered file, so each comment cites a line.`}
      </p>
      <div className="editor-foot">
        <button type="button" className="ds-button" onClick={onClear} disabled={running || !code}>
          Clear
        </button>
        <button type="button" className="ds-button ds-button--primary editor-foot__run" onClick={onReview} disabled={!canReview} aria-busy={running}>
          {running ? 'Reviewing…' : 'Review code'}
        </button>
      </div>
    </section>
  )
}
