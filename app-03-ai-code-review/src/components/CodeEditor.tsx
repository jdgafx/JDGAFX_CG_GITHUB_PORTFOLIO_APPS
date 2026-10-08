import type { KeyboardEvent, RefObject, UIEvent } from 'react'

interface CodeEditorProps {
  code: string
  highlightedLine: number | null
  textareaRef: RefObject<HTMLTextAreaElement | null>
  lineNumbersRef: RefObject<HTMLDivElement | null>
  onChange: (value: string) => void
  onSubmit: () => void
}

export function CodeEditor({
  code,
  highlightedLine,
  textareaRef,
  lineNumbersRef,
  onChange,
  onSubmit,
}: CodeEditorProps) {
  const lineCount = code.split('\n').length

  const handleScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      onSubmit()
      return
    }
    // Shift+Tab is left alone so keyboard users can always step back out of the field.
    if (e.key === 'Tab' && !e.shiftKey) {
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
    <div className="ds-field">
      <label className="ds-label" htmlFor="code-input">
        Code to review
      </label>
      <div className="editor">
        <div className="editor__gutter" ref={lineNumbersRef} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => i + 1).map((num) => (
            <span key={num} className={num === highlightedLine ? 'editor__num is-active' : 'editor__num'}>
              {num}
            </span>
          ))}
        </div>
        <textarea
          id="code-input"
          ref={textareaRef}
          className="ds-textarea editor__input"
          value={code}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          placeholder={'// Paste your code here.\n// Tab inserts two spaces.'}
          spellCheck={false}
          wrap="off"
        />
      </div>
    </div>
  )
}
