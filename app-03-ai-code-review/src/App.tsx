import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Code2,
  Zap,
  AlertTriangle,
  Info,
  AlertCircle,
  ChevronDown,
  Loader2,
  FileCode2,
} from 'lucide-react'
import { reviewCode } from './lib/api'
import type { ReviewComment, ReviewResult, Severity } from './types'

interface IconProps {
  size?: number
  color?: string
  strokeWidth?: number
  style?: React.CSSProperties
}

interface SeverityInfo {
  label: string
  color: string
  bg: string
  borderColor: string
  icon: React.ComponentType<IconProps>
}

const LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'sql', label: 'SQL' },
]

const SEVERITY_CONFIG: Record<Severity, SeverityInfo> = {
  critical: {
    label: 'Critical',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.08)',
    borderColor: '#ef4444',
    icon: AlertCircle,
  },
  warning: {
    label: 'Warning',
    color: '#ffa500',
    bg: 'rgba(255, 165, 0, 0.08)',
    borderColor: '#ffa500',
    icon: AlertTriangle,
  },
  info: {
    label: 'Info',
    color: '#60a5fa',
    bg: 'rgba(96, 165, 250, 0.08)',
    borderColor: '#60a5fa',
    icon: Info,
  },
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

function getFileExt(lang: string): string {
  if (lang === 'javascript') return 'js'
  if (lang === 'typescript') return 'ts'
  if (lang === 'python') return 'py'
  if (lang === 'rust') return 'rs'
  if (lang === 'cpp') return 'cpp'
  if (lang === 'java') return 'java'
  if (lang === 'go') return 'go'
  return lang
}

interface LineNumbersProps {
  lineCount: number
  highlightedLine: number | null
  scrollRef: React.RefObject<HTMLDivElement | null>
}

function LineNumbers({ lineCount, highlightedLine, scrollRef }: LineNumbersProps) {
  return (
    <div
      ref={scrollRef}
      style={{
        width: '52px',
        minWidth: '52px',
        overflowY: 'hidden',
        backgroundColor: '#0a0f1a',
        borderRight: '1px solid rgba(255,255,255,0.05)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '13px',
        lineHeight: '24px',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {Array.from({ length: lineCount }, (_, i) => i + 1).map((num) => (
        <div
          key={num}
          style={{
            height: '24px',
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

interface ReviewCardProps {
  comment: ReviewComment
  index: number
  onClick: () => void
  isActive: boolean
}

function ReviewCard({ comment, index, onClick, isActive }: ReviewCardProps) {
  const config = SEVERITY_CONFIG[comment.severity]
  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ delay: index * 0.06, duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
      onClick={onClick}
      style={{
        background: isActive ? config.bg : 'rgba(255,255,255,0.02)',
        border: `1px solid ${isActive ? config.borderColor + '55' : 'rgba(255,255,255,0.06)'}`,
        borderLeft: `4px solid ${config.color}`,
        borderRadius: '8px',
        padding: '14px 16px',
        cursor: 'pointer',
        marginBottom: '10px',
        transition: 'background 0.2s ease, border-color 0.2s ease',
      }}
      whileHover={{ backgroundColor: config.bg }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            borderRadius: '999px',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase' as const,
            backgroundColor: config.bg,
            color: config.color,
            border: `1px solid ${config.color}44`,
          }}
        >
          <Icon size={10} />
          {config.label}
        </span>
        <span
          style={{
            fontSize: '12px',
            color: '#4b5563',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Line {comment.line}
        </span>
      </div>

      <p
        style={{
          margin: '0 0 8px 0',
          fontSize: '13.5px',
          color: '#e2e8f0',
          lineHeight: 1.55,
          fontWeight: 500,
        }}
      >
        {comment.message}
      </p>

      <div
        style={{
          fontSize: '12.5px',
          color: '#94a3b8',
          lineHeight: 1.55,
          borderTop: '1px solid rgba(255,255,255,0.05)',
          paddingTop: '8px',
        }}
      >
        <span style={{ color: '#ffa500', fontWeight: 600 }}>Suggestion: </span>
        {comment.suggestion}
      </div>
    </motion.div>
  )
}

function SkeletonCard({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.07 }}
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderLeft: '4px solid rgba(255,255,255,0.08)',
        borderRadius: '8px',
        padding: '14px 16px',
        marginBottom: '10px',
      }}
    >
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
        <div className="skeleton" style={{ width: '72px', height: '20px', borderRadius: '999px' }} />
        <div className="skeleton" style={{ width: '52px', height: '20px', borderRadius: '4px' }} />
      </div>
      <div className="skeleton" style={{ width: '88%', height: '14px', borderRadius: '4px', marginBottom: '6px' }} />
      <div className="skeleton" style={{ width: '65%', height: '14px', borderRadius: '4px', marginBottom: '12px' }} />
      <div className="skeleton" style={{ width: '100%', height: '14px', borderRadius: '4px' }} />
    </motion.div>
  )
}

function EmptyState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '16px',
        textAlign: 'center',
        padding: '40px 24px',
      }}
    >
      <div
        style={{
          width: '72px',
          height: '72px',
          borderRadius: '16px',
          background: 'rgba(255,165,0,0.06)',
          border: '1px solid rgba(255,165,0,0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <FileCode2 size={32} color="#ffa500" strokeWidth={1.5} />
      </div>
      <div>
        <p style={{ margin: '0 0 8px 0', fontSize: '15px', fontWeight: 600, color: '#6b7280' }}>
          No Review Yet
        </p>
        <p style={{ margin: 0, fontSize: '13px', color: '#4b5563', lineHeight: 1.65 }}>
          Paste your code in the editor and
          <br />
          click{' '}
          <strong style={{ color: '#ffa500' }}>Review Code</strong> to begin
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('javascript')
  const [isLoading, setIsLoading] = useState(false)
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null)
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)

  const lineCount = Math.max(code.split('\n').length, 20)

  const handleTextareaScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop
    }
  }

  useEffect(() => {
    if (highlightedLine !== null) {
      const lineHeight = 24
      const scrollTo = Math.max(0, (highlightedLine - 1) * lineHeight - 80)
      if (textareaRef.current) {
        textareaRef.current.scrollTop = scrollTo
      }
      if (lineNumbersRef.current) {
        lineNumbersRef.current.scrollTop = scrollTo
      }
    }
  }, [highlightedLine])

  const handleReview = async () => {
    if (!code.trim() || isLoading) return
    setIsLoading(true)
    setError(null)
    setHighlightedLine(null)
    try {
      const result = await reviewCode(code, language)
      setReviewResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCommentClick = (line: number) => {
    setHighlightedLine((prev) => (prev === line ? null : line))
  }

  const sortedComments = reviewResult
    ? reviewResult.comments.slice().sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    : []

  const criticalCount = reviewResult?.comments.filter((c) => c.severity === 'critical').length ?? 0
  const warningCount = reviewResult?.comments.filter((c) => c.severity === 'warning').length ?? 0
  const infoCount = reviewResult?.comments.filter((c) => c.severity === 'info').length ?? 0

  const btnDisabled = isLoading || !code.trim()

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0a0e1a',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <header
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(10,14,26,0.9)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            maxWidth: '1400px',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap' as const,
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '9px',
                background: 'linear-gradient(135deg, #ffa500, #ff6b00)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 20px rgba(255,165,0,0.3)',
                flexShrink: 0,
              }}
            >
              <Code2 size={18} color="#fff" />
            </div>
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: '18px',
                  fontWeight: 700,
                  color: '#f1f5f9',
                  letterSpacing: '-0.02em',
                  lineHeight: 1.2,
                }}
              >
                CodeLens<span style={{ color: '#ffa500' }}> AI</span>
              </h1>
              <p style={{ margin: 0, fontSize: '12px', color: '#4b5563', lineHeight: 1.3 }}>
                AI-Powered Code Review Agent
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' as const }}>
            {(['critical', 'warning', 'info'] as Severity[]).map((sev) => {
              const conf = SEVERITY_CONFIG[sev]
              const Icon = conf.icon
              return (
                <span
                  key={sev}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '11px',
                    fontWeight: 500,
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    color: conf.color,
                    border: `1px solid ${conf.color}22`,
                  }}
                >
                  <Icon size={11} />
                  {conf.label}
                </span>
              )
            })}
          </div>
        </div>
      </header>
      <div style={{ width: '100%', padding: '8px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,165,0,0.02)', flexShrink: 0 }}>
        <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.55, maxWidth: 860 }}>
          Paste code in any supported language (JavaScript, TypeScript, Python, Rust, Go, Java, C++, and more) and get an instant AI-powered review. Claude analyzes your code line-by-line, flagging critical bugs, warnings, and suggestions with severity ratings. Each comment links to the exact line number, includes an explanation of the issue, and recommends a fix. Use this to catch bugs, improve code quality, and learn best practices.
        </p>
      </div>

      <main
        style={{
          flex: 1,
          maxWidth: '1400px',
          margin: '0 auto',
          width: '100%',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap' as const,
          }}
        >
          <div style={{ position: 'relative' }}>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
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
                fontFamily: "'Inter', sans-serif",
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

          <span style={{ fontSize: '12px', color: '#374151' }}>
            {code.split('\n').length} lines
          </span>

          <div style={{ flex: 1 }} />

          <AnimatePresence>
            {reviewResult && !isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ display: 'flex', gap: '10px', alignItems: 'center' }}
              >
                {criticalCount > 0 && (
                  <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: 500 }}>
                    {criticalCount} critical
                  </span>
                )}
                {warningCount > 0 && (
                  <span style={{ fontSize: '12px', color: '#ffa500', fontWeight: 500 }}>
                    {warningCount} warning{warningCount > 1 ? 's' : ''}
                  </span>
                )}
                {infoCount > 0 && (
                  <span style={{ fontSize: '12px', color: '#60a5fa', fontWeight: 500 }}>
                    {infoCount} info
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="split-layout">
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
              <div style={{ display: 'flex', gap: '5px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', opacity: 0.6 }} />
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ffa500', opacity: 0.6 }} />
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e', opacity: 0.6 }} />
              </div>
              <span style={{ fontSize: '12px', color: '#374151', marginLeft: '4px' }}>
                code.{getFileExt(language)}
              </span>
              <div style={{ flex: 1 }} />
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: code.trim() ? '#22c55e' : '#374151',
                  transition: 'background 0.3s ease',
                }}
              />
            </div>

            <div
              style={{
                flex: 1,
                display: 'flex',
                overflow: 'hidden',
                minHeight: 0,
              }}
            >
              <LineNumbers
                lineCount={lineCount}
                highlightedLine={highlightedLine}
                scrollRef={lineNumbersRef}
              />
              <textarea
                ref={textareaRef}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value)
                  setHighlightedLine(null)
                }}
                onScroll={handleTextareaScroll}
                placeholder={'// Paste your code here...\n// Supports JS, TS, Python, Rust, Go, and more'}
                spellCheck={false}
                style={{
                  flex: 1,
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#e2e8f0',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '13px',
                  lineHeight: '24px',
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

          <div
            className="review-panel"
            style={{
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.06)',
              overflow: 'hidden',
              background: 'rgba(255,255,255,0.01)',
            }}
          >
            <div
              style={{
                padding: '9px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(0,0,0,0.2)',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: '11px', color: '#4b5563', fontWeight: 600, letterSpacing: '0.06em' }}>
                REVIEW RESULTS
              </span>
              <AnimatePresence>
                {reviewResult && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    style={{
                      marginLeft: 'auto',
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      background: 'rgba(255,165,0,0.1)',
                      color: '#ffa500',
                      border: '1px solid rgba(255,165,0,0.2)',
                      fontWeight: 600,
                    }}
                  >
                    {reviewResult.comments.length} issue{reviewResult.comments.length !== 1 ? 's' : ''}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '14px',
                minHeight: 0,
              }}
            >
              {isLoading ? (
                <>
                  {[0, 1, 2, 3].map((i) => (
                    <SkeletonCard key={i} index={i} />
                  ))}
                </>
              ) : error ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    gap: '12px',
                    textAlign: 'center',
                    padding: '40px 24px',
                  }}
                >
                  <AlertCircle size={32} color="#ef4444" strokeWidth={1.5} />
                  <div>
                    <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#ef4444', fontSize: '14px' }}>
                      Review Failed
                    </p>
                    <p style={{ margin: 0, fontSize: '13px', color: '#6b7280', lineHeight: 1.5 }}>
                      {error}
                    </p>
                  </div>
                </div>
              ) : reviewResult ? (
                <AnimatePresence>
                  {sortedComments.map((comment, i) => (
                    <ReviewCard
                      key={`${i}-${comment.severity}`}
                      comment={comment}
                      index={i}
                      onClick={() => handleCommentClick(comment.line)}
                      isActive={highlightedLine === comment.line}
                    />
                  ))}
                </AnimatePresence>
              ) : (
                <EmptyState />
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: '8px' }}>
          <motion.button
            onClick={handleReview}
            disabled={btnDisabled}
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
              fontFamily: "'Inter', sans-serif",
              letterSpacing: '0.01em',
              boxShadow: btnDisabled
                ? 'none'
                : '0 0 28px rgba(255,165,0,0.25), 0 4px 14px rgba(0,0,0,0.3)',
              transition: 'background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease',
            }}
          >
            {isLoading ? (
              <>
                <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} />
                Analyzing...
              </>
            ) : (
              <>
                <Zap size={16} />
                Review Code
              </>
            )}
          </motion.button>
        </div>
      </main>
      <footer style={{ textAlign: 'center', padding: '12px 0', fontSize: 11, color: '#475569', borderTop: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
      </footer>
    </div>
  )
}
