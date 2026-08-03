import { getFileExt, LINE_HEIGHT } from '../constants'

interface LineNumbersProps {
  lineCount: number
  highlightedLine: number | null
  scrollRef: React.RefObject<HTMLDivElement | null>
}

function LineNumbers({ lineCount, highlightedLine, scrollRef }: LineNumbersProps) {
  return (
    <div
      ref={scrollRef}
      aria-hidden="true"
      style={{
        width: '52px',
        minWidth: '52px',
        overflowY: 'hidden',
        backgroundColor: '#0a0f1a',
        borderRight: '1px solid rgba(255,255,255,0.05)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '13px',
        lineHeight: `${LINE_HEIGHT}px`,
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {Array.from({ length: lineCount }, (_, i) => i + 1).map((num) => (
        <div
          key={num}
          style={{
            height: `${LINE_HEIGHT}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingRight: '10px',
            backgroundColor:
              num === highlightedLine ? 'rgba(255, 165, 0, 0.12)' : 'transparent',
            color: num === highlightedLine ? '#ffa500' : '#374151',
            borderLeft:
              num === highlightedLine ? '2px solid #ffa500' : '2px solid transparent',
            transition: 'all 0.2s ease',
          }}
        >
          {num}
        </div>
      ))}
    </div>
  )
}

interface CodeEditorProps {
  code: string
  language: string
  highlightedLine: number | null
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  lineNumbersRef: React.RefObject<HTMLDivElement | null>
  onChange: (value: string) => void
  onSubmit: () => void
}

export function CodeEditor({
  code,
  language,
  highlightedLine,
  textareaRef,
  lineNumbersRef,
  onChange,
  onSubmit,
}: CodeEditorProps) {
  const lineCount = code.split('\n').length

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      const next = `${code.slice(0, selectionStart)}  ${code.slice(selectionEnd)}`
      onChange(next)
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = selectionStart + 2
      })
    }
  }

  return (
    <div
      className="editor-panel"
      style={{
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.06)',
        overflow: 'hidden',
        background: '#0d1117',
      }}
    >
      <div
        style={{
          padding: '9px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: '#0a0f1a',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: '5px' }} aria-hidden="true">
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', opacity: 0.6 }} />
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ffa500', opacity: 0.6 }} />
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e', opacity: 0.6 }} />
        </div>
        <span
          style={{ fontSize: '12px', color: '#374151', marginLeft: '4px' }}
          title={`Your snippet is reviewed as a ${language} file`}
        >
          code.{getFileExt(language)}
        </span>
        <div style={{ flex: 1 }} />
        <div
          title={code.trim() ? 'Editor has code ready to review' : 'Editor is empty'}
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: code.trim() ? '#22c55e' : '#374151',
            transition: 'background 0.3s ease',
          }}
        />
      </div>

      <div className="editor-body">
        <LineNumbers
          lineCount={lineCount}
          highlightedLine={highlightedLine}
          scrollRef={lineNumbersRef}
        />
        <label htmlFor="code-input" className="sr-only">
          Code to review
        </label>
        <textarea
          id="code-input"
          ref={textareaRef}
          value={code}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          placeholder={'// Paste your code here...\n// Supports JS, TS, Python, Rust, Go, and more'}
          spellCheck={false}
          title="Paste or type the code you want reviewed. Tab inserts two spaces; Ctrl/Cmd+Enter starts the review."
          style={{
            flex: 1,
            minWidth: 0,
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#e2e8f0',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '13px',
            lineHeight: `${LINE_HEIGHT}px`,
            padding: '0 16px',
            resize: 'none',
            tabSize: 2,
            overflowY: 'scroll',
            overflowX: 'auto',
            whiteSpace: 'pre',
            caretColor: '#ffa500',
          }}
        />
      </div>
    </div>
  )
}
