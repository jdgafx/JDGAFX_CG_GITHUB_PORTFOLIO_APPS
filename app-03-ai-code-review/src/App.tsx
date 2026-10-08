import { useCallback, useEffect, useRef, useState } from 'react'
import { Header, statusBadge } from './components/Header'
import { ReviewForm } from './components/ReviewForm'
import { ReviewPanel } from './components/ReviewPanel'
import { RunTrace } from './components/RunTrace'
import { ReviewError, reviewCode, reviewErrorMessage } from './lib/api'
import { MAX_CODE_LENGTH } from './lib/limits'
import { LINE_HEIGHT, SAMPLE_CODE, SAMPLE_LANGUAGE, SEVERITY_CONFIG, SEVERITY_ORDER } from './constants'
import type { ReviewComment, ReviewResult, RunPhase, RunSummary, Severity } from './types'

const ALL_SEVERITIES_ON: Record<Severity, boolean> = { critical: true, warning: true, info: true }

function bySeverityThenLine(a: ReviewComment, b: ReviewComment): number {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line
}

function countBySeverity(comments: ReviewComment[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 }
  for (const c of comments) counts[c.severity] += 1
  return counts
}

export default function App() {
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('javascript')
  const [phase, setPhase] = useState<RunPhase>('idle')
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null)
  const [filters, setFilters] = useState<Record<Severity, boolean>>(ALL_SEVERITIES_ON)
  const [copied, setCopied] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const comments = result ? [...result.comments].sort(bySeverityThenLine) : []
  const visibleComments = comments.filter((c) => filters[c.severity])
  const counts = countBySeverity(comments)

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
    if (!code.trim() || code.length > MAX_CODE_LENGTH || phase === 'running') return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setPhase('running')
    setResult(null)
    setSummary(null)
    setError(null)
    setHighlightedLine(null)
    setFilters(ALL_SEVERITIES_ON)
    setCopied(false)
    try {
      const run = await reviewCode(code, language, controller.signal)
      if (controller.signal.aborted) return
      const { result: next, ...runSummary } = run
      setResult(next)
      setSummary(runSummary)
      setPhase('done')
    } catch (err) {
      if (controller.signal.aborted) return
      setError(reviewErrorMessage(err))
      if (err instanceof ReviewError) setSummary(err.summary)
      else console.error('CodeLens: unexpected review error', err)
      setPhase('failed')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [code, language, phase])

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

  const handleCancel = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setPhase('idle')
    setError(null)
  }

  const clearResults = () => {
    setPhase('idle')
    setResult(null)
    setSummary(null)
    setError(null)
    setHighlightedLine(null)
  }

  const handleCodeChange = (value: string) => {
    setCode(value)
    setHighlightedLine(null)
  }

  const handleLoadSample = () => {
    setLanguage(SAMPLE_LANGUAGE)
    setCode(SAMPLE_CODE)
    clearResults()
    textareaRef.current?.focus()
  }

  const handleClear = () => {
    setCode('')
    clearResults()
    textareaRef.current?.focus()
  }

  const handleShowLine = (line: number) => {
    setHighlightedLine((prev) => (prev === line ? null : line))
  }

  const handleToggleFilter = (severity: Severity) => {
    setFilters((prev) => ({ ...prev, [severity]: !prev[severity] }))
  }

  const handleCopy = async () => {
    if (!result) return
    const n = result.comments.length
    const header = `CodeLens AI review - ${language}, ${result.lineCount} line${result.lineCount !== 1 ? 's' : ''}, ${n} issue${n !== 1 ? 's' : ''}`
    const body = comments
      .map(
        (c) => `[${SEVERITY_CONFIG[c.severity].label.toUpperCase()}] Line ${c.line}\n  ${c.message}\n  Suggestion: ${c.suggestion}`,
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
    <div className="ds-app">
      <Header badge={statusBadge(phase, comments.length)} />

      <main className="ds-main">
        <div className="ds-grid-2 review-layout">
          <ReviewForm
            code={code}
            language={language}
            phase={phase}
            highlightedLine={highlightedLine}
            textareaRef={textareaRef}
            lineNumbersRef={lineNumbersRef}
            onCodeChange={handleCodeChange}
            onLanguageChange={setLanguage}
            onReview={() => void handleReview()}
            onCancel={handleCancel}
            onSample={handleLoadSample}
            onClear={handleClear}
          />
          <ReviewPanel
            phase={phase}
            error={error}
            result={result}
            visibleComments={visibleComments}
            counts={counts}
            filters={filters}
            highlightedLine={highlightedLine}
            copied={copied}
            onToggleFilter={handleToggleFilter}
            onShowLine={handleShowLine}
            onRetry={() => void handleReview()}
            onCopy={() => void handleCopy()}
          />
        </div>

        <RunTrace phase={phase} summary={summary} />
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
