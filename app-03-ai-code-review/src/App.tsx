import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, Loader2, Trash2, Wand2, X, Zap } from 'lucide-react'
import { Header } from './components/Header'
import { CodeEditor } from './components/CodeEditor'
import { ReviewPanel } from './components/ReviewPanel'
import { reviewCode } from './lib/api'
import { MAX_CODE_LENGTH, OVER_LIMIT_MESSAGE } from './lib/limits'
import {
  LANGUAGES,
  LINE_HEIGHT,
  SAMPLE_CODE,
  SAMPLE_LANGUAGE,
  SEVERITY_CONFIG,
  SEVERITY_ORDER,
} from './constants'
import type { ReviewResult, Severity } from './types'

const ALL_SEVERITIES_ON: Record<Severity, boolean> = { critical: true, warning: true, info: true }

const TOOL_BUTTON: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.04)',
  color: '#94a3b8',
  fontSize: '12.5px',
  fontFamily: "'Source Sans 3', sans-serif",
  cursor: 'pointer',
}

export default function App() {
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('javascript')
  const [isLoading, setIsLoading] = useState(false)
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null)
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Record<Severity, boolean>>(ALL_SEVERITIES_ON)
  const [copied, setCopied] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const codeLength = code.length
  const isOverLimit = codeLength > MAX_CODE_LENGTH
  const btnDisabled = isLoading || !code.trim() || isOverLimit

  const sortedComments = reviewResult
    ? reviewResult.comments
        .slice()
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line)
    : []
  const visibleComments = sortedComments.filter((c) => filters[c.severity])
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 }
  for (const c of sortedComments) counts[c.severity] += 1

  // Drop the in-flight review and the pending copy reset when the component goes away.
  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (highlightedLine === null) return
    const el = textareaRef.current
    if (!el) return
    const centered = (highlightedLine - 1) * LINE_HEIGHT - el.clientHeight / 2 + LINE_HEIGHT / 2
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
    const next = Math.min(Math.max(0, centered), maxScroll)
    el.scrollTop = next
    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = next
  }, [highlightedLine])

  const handleReview = useCallback(async () => {
    if (!code.trim() || isOverLimit || isLoading) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setError(null)
    setReviewResult(null)
    setHighlightedLine(null)
    setFilters(ALL_SEVERITIES_ON)
    setCopied(false)
    try {
      const result = await reviewCode(code, language, controller.signal)
      if (controller.signal.aborted) return
      setReviewResult(result)
    } catch (err) {
      if (controller.signal.aborted && (err as Error)?.name === 'AbortError') return
      if ((err as Error)?.name === 'TimeoutError') {
        setError('The review took too long to come back. Try a shorter snippet.')
      } else {
        setError(err instanceof Error ? err.message : 'Review failed. Please try again.')
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setIsLoading(false)
      }
    }
  }, [code, language, isLoading, isOverLimit])

  const handleCancel = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsLoading(false)
    setError(null)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void handleReview()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleReview])

  const handleCodeChange = (value: string) => {
    setCode(value)
    setHighlightedLine(null)
  }

  const handleLoadSample = () => {
    setLanguage(SAMPLE_LANGUAGE)
    setCode(SAMPLE_CODE)
    setReviewResult(null)
    setError(null)
    setHighlightedLine(null)
    textareaRef.current?.focus()
  }

  const handleClear = () => {
    setCode('')
    setReviewResult(null)
    setError(null)
    setHighlightedLine(null)
    textareaRef.current?.focus()
  }

  const handleCommentClick = (line: number) => {
    setHighlightedLine((prev) => (prev === line ? null : line))
  }

  const handleToggleFilter = (severity: Severity) => {
    setFilters((prev) => ({ ...prev, [severity]: !prev[severity] }))
  }

  const handleCopy = async () => {
    if (!reviewResult) return
    const header = `CodeLens AI review - ${language}, ${reviewResult.lineCount} line${reviewResult.lineCount !== 1 ? 's' : ''}, ${reviewResult.comments.length} issue${reviewResult.comments.length !== 1 ? 's' : ''}`
    const body = sortedComments
      .map(
        (c) =>
          `[${SEVERITY_CONFIG[c.severity].label.toUpperCase()}] Line ${c.line}\n  ${c.message}\n  Suggestion: ${c.suggestion}`,
      )
      .join('\n\n')
    try {
      await navigator.clipboard.writeText(`${header}\n\n${body}\n`)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="app-shell" style={{ backgroundColor: '#0a0e1a' }}>
      <Header
        counts={counts}
        filters={filters}
        hasResults={!!reviewResult && sortedComments.length > 0}
        onToggleFilter={handleToggleFilter}
      />

      <div
        style={{
          width: '100%',
          padding: '8px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,165,0,0.02)',
          flexShrink: 0,
        }}
      >
        <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.55, maxWidth: 860 }}>
          Paste your code — any language — and get a line-by-line review in seconds. It flags bugs and security issues as critical, highlights things worth fixing as warnings, and offers suggestions where the code could be cleaner. Each comment links directly to the line it's talking about.
        </p>
      </div>

      <main className="app-main">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap' as const,
            flexShrink: 0,
          }}
        >
          <label htmlFor="language-select" className="sr-only">
            Code language
          </label>
          <div style={{ position: 'relative' }}>
            <select
              id="language-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              title="Tell the reviewer which language this snippet is written in"
              style={{
                appearance: 'none' as const,
                WebkitAppearance: 'none' as const,
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px',
                padding: '7px 34px 7px 12px',
                fontSize: '13px',
                color: '#e2e8f0',
                cursor: 'pointer',
                fontFamily: "'Source Sans 3', sans-serif",
                outline: 'none',
              }}
            >
              {LANGUAGES.map((lang) => (
                <option
                  key={lang.value}
                  value={lang.value}
                  style={{ backgroundColor: '#1a1f2e', color: '#e2e8f0' }}
                >
                  {lang.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              color="#6b7280"
              style={{
                position: 'absolute',
                right: '9px',
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
              }}
            />
          </div>

          <span
            style={{ fontSize: '12px', color: isOverLimit ? '#ef4444' : '#374151' }}
            title={`${codeLength.toLocaleString('en-US')} of ${MAX_CODE_LENGTH.toLocaleString('en-US')} characters used`}
          >
            {code.split('\n').length} lines
          </span>

          {isOverLimit && (
            <span role="alert" style={{ fontSize: '12px', color: '#ef4444', fontWeight: 600 }}>
              {OVER_LIMIT_MESSAGE} — remove{' '}
              {(codeLength - MAX_CODE_LENGTH).toLocaleString('en-US')} characters to review it.
            </span>
          )}

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={handleLoadSample}
            title="Load a short JavaScript snippet with known problems to try the reviewer"
            style={TOOL_BUTTON}
          >
            <Wand2 size={13} />
            Sample code
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={!code}
            title={code ? 'Empty the editor and discard the current review' : 'The editor is already empty'}
            style={{ ...TOOL_BUTTON, opacity: code ? 1 : 0.4, cursor: code ? 'pointer' : 'not-allowed' }}
          >
            <Trash2 size={13} />
            Clear
          </button>
        </div>

        <div className="split-layout">
          <CodeEditor
            code={code}
            language={language}
            highlightedLine={highlightedLine}
            textareaRef={textareaRef}
            lineNumbersRef={lineNumbersRef}
            onChange={handleCodeChange}
            onSubmit={() => void handleReview()}
          />

          <ReviewPanel
            isLoading={isLoading}
            error={error}
            reviewResult={reviewResult}
            visibleComments={visibleComments}
            hiddenCount={sortedComments.length - visibleComments.length}
            highlightedLine={highlightedLine}
            copied={copied}
            onCommentClick={handleCommentClick}
            onRetry={() => void handleReview()}
            onCopy={() => void handleCopy()}
          />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '10px',
            paddingBottom: '8px',
            flexShrink: 0,
          }}
        >
          <motion.button
            type="button"
            onClick={() => void handleReview()}
            disabled={btnDisabled}
            title={
              isOverLimit
                ? `${OVER_LIMIT_MESSAGE} — trim the snippet before reviewing`
                : !code.trim()
                  ? 'Paste some code first'
                  : 'Send this code for AI review (Ctrl/Cmd+Enter)'
            }
            whileHover={btnDisabled ? {} : { scale: 1.02 }}
            whileTap={btnDisabled ? {} : { scale: 0.97 }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '11px 32px',
              borderRadius: '10px',
              border: 'none',
              background: btnDisabled
                ? 'rgba(255,165,0,0.15)'
                : 'linear-gradient(135deg, #ffa500, #ff7000)',
              color: btnDisabled ? 'rgba(255,165,0,0.4)' : '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: btnDisabled ? 'not-allowed' : 'pointer',
              fontFamily: "'Source Sans 3', sans-serif",
              letterSpacing: '0.01em',
              boxShadow: btnDisabled
                ? 'none'
                : '0 0 28px rgba(255,165,0,0.25), 0 4px 14px rgba(0,0,0,0.3)',
              transition: 'background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease',
            }}
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Zap size={16} />
                Review Code
              </>
            )}
          </motion.button>

          {isLoading && (
            <button
              type="button"
              onClick={handleCancel}
              title="Stop this review and keep the editor as it is"
              style={{ ...TOOL_BUTTON, padding: '10px 18px', color: '#e2e8f0' }}
            >
              <X size={14} />
              Cancel
            </button>
          )}
        </div>
      </main>

      <footer
        style={{
          textAlign: 'center',
          padding: '12px 0',
          fontSize: 11,
          color: '#475569',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          flexShrink: 0,
        }}
      >
        Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
      </footer>
    </div>
  )
}
