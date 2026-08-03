import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, Check, CheckCircle2, Copy, FileCode2, Filter, RotateCcw } from 'lucide-react'
import { ReviewCard } from './ReviewCard'
import type { ReviewComment, ReviewResult } from '../types'

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

interface CenteredStateProps {
  icon: React.ReactNode
  title: string
  titleColor: string
  children: React.ReactNode
}

function CenteredState({ icon, title, titleColor, children }: CenteredStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '14px',
        textAlign: 'center',
        padding: '40px 24px',
      }}
    >
      {icon}
      <div>
        <p style={{ margin: '0 0 8px 0', fontSize: '15px', fontWeight: 600, color: titleColor }}>
          {title}
        </p>
        <div style={{ margin: 0, fontSize: '13px', color: '#6b7280', lineHeight: 1.65 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

const ACTION_BUTTON: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 14px',
  borderRadius: '8px',
  border: '1px solid rgba(255,165,0,0.3)',
  background: 'rgba(255,165,0,0.08)',
  color: '#ffa500',
  fontSize: '12.5px',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: "'Source Sans 3', sans-serif",
}

interface ReviewPanelProps {
  isLoading: boolean
  error: string | null
  reviewResult: ReviewResult | null
  visibleComments: ReviewComment[]
  hiddenCount: number
  highlightedLine: number | null
  copied: boolean
  onCommentClick: (line: number) => void
  onRetry: () => void
  onCopy: () => void
}

export function ReviewPanel({
  isLoading,
  error,
  reviewResult,
  visibleComments,
  hiddenCount,
  highlightedLine,
  copied,
  onCommentClick,
  onRetry,
  onCopy,
}: ReviewPanelProps) {
  const total = reviewResult?.comments.length ?? 0
  const canCopy = !!reviewResult && total > 0 && !isLoading

  return (
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
        <div style={{ flex: 1 }} />
        {canCopy && (
          <button
            type="button"
            onClick={onCopy}
            title="Copy the full review to your clipboard as plain text"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '2px 8px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'transparent',
              color: copied ? '#22c55e' : '#6b7280',
              fontSize: '11px',
              cursor: 'pointer',
              fontFamily: "'Source Sans 3', sans-serif",
            }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
        <AnimatePresence>
          {reviewResult && !isLoading && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              title={
                hiddenCount > 0
                  ? `${total} issue${total !== 1 ? 's' : ''} found, ${hiddenCount} hidden by the severity filters`
                  : `${total} issue${total !== 1 ? 's' : ''} found in this snippet`
              }
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '999px',
                background: 'rgba(255,165,0,0.1)',
                color: '#ffa500',
                border: '1px solid rgba(255,165,0,0.2)',
                fontWeight: 600,
              }}
            >
              {total} issue{total !== 1 ? 's' : ''}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div
        aria-live="polite"
        aria-busy={isLoading}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px',
          minHeight: 0,
        }}
      >
        {isLoading ? (
          <>
            <p style={{ margin: '0 0 12px', fontSize: '12.5px', color: '#6b7280' }}>
              Reviewing your code...
            </p>
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard key={i} index={i} />
            ))}
          </>
        ) : error ? (
          <div role="alert">
            <CenteredState
              icon={<AlertCircle size={32} color="#ef4444" strokeWidth={1.5} />}
              title="Review Failed"
              titleColor="#ef4444"
            >
              <p style={{ margin: '0 0 16px' }}>{error}</p>
              <button
                type="button"
                onClick={onRetry}
                title="Send the same code for review again"
                style={ACTION_BUTTON}
              >
                <RotateCcw size={13} />
                Retry review
              </button>
            </CenteredState>
          </div>
        ) : reviewResult && total === 0 ? (
          <CenteredState
            icon={<CheckCircle2 size={32} color="#22c55e" strokeWidth={1.5} />}
            title="No Issues Found"
            titleColor="#22c55e"
          >
            <p style={{ margin: 0 }}>
              The reviewer read all {reviewResult.lineCount} line
              {reviewResult.lineCount !== 1 ? 's' : ''} and flagged nothing worth changing.
              <br />
              Reviews are AI-selective, so a clean result is not a guarantee.
            </p>
          </CenteredState>
        ) : reviewResult && visibleComments.length === 0 ? (
          <CenteredState
            icon={<Filter size={32} color="#ffa500" strokeWidth={1.5} />}
            title="Everything Is Filtered Out"
            titleColor="#ffa500"
          >
            <p style={{ margin: 0 }}>
              All {total} issue{total !== 1 ? 's are' : ' is'} hidden by the severity filters.
              <br />
              Re-enable a severity in the header to see them.
            </p>
          </CenteredState>
        ) : reviewResult ? (
          <>
            {reviewResult.truncated && (
              <p
                role="status"
                style={{
                  margin: '0 0 12px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,165,0,0.25)',
                  background: 'rgba(255,165,0,0.06)',
                  fontSize: '12px',
                  color: '#ffa500',
                  lineHeight: 1.5,
                }}
              >
                The reviewer hit its length limit, so this list may be incomplete. Try a shorter
                snippet for full coverage.
              </p>
            )}
            <AnimatePresence>
              {visibleComments.map((comment, i) => (
                // Keyed on content, not index, so toggling a filter does not remount
                // (and re-animate) every surviving card.
                <ReviewCard
                  key={`${comment.line}-${comment.severity}-${comment.message}`}
                  comment={comment}
                  index={i}
                  onClick={() => onCommentClick(comment.line)}
                  isActive={highlightedLine === comment.line}
                />
              ))}
            </AnimatePresence>
            <p style={{ margin: '4px 0 0', fontSize: '11.5px', color: '#4b5563', lineHeight: 1.5 }}>
              Reviews are AI-selective: the highest-value findings across the file, not an
              exhaustive audit of every line.
            </p>
          </>
        ) : (
          <CenteredState
            icon={
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
            }
            title="No Review Yet"
            titleColor="#6b7280"
          >
            <p style={{ margin: 0, color: '#4b5563' }}>
              Paste your code in the editor and
              <br />
              click <strong style={{ color: '#ffa500' }}>Review Code</strong> to begin
            </p>
          </CenteredState>
        )}
      </div>
    </div>
  )
}
