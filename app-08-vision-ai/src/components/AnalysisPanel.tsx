import type { RefObject } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, Info, Loader2, Send, Square } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AnalysisMode } from '../lib/api'
import Markdown from './Markdown'

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="block w-1 h-1 rounded-full bg-rose-400"
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.3 }}
        />
      ))}
    </span>
  )
}

const MODE_HINTS: Record<AnalysisMode, string> = {
  describe: 'Rich, plain-language description of the whole image',
  analyze: 'Technical breakdown: composition, colour, objects, quality',
  qa: 'Ask a specific question about the image',
  extract: 'Pull out text, numbers, and tables from the image',
}

interface AnalysisPanelProps {
  modes: Array<{ id: AnalysisMode; label: string; icon: LucideIcon }>
  modeLabels: Record<AnalysisMode, string>
  mode: AnalysisMode
  onModeChange: (mode: AnalysisMode) => void
  question: string
  questionError: string
  onQuestionChange: (value: string) => void
  isLoading: boolean
  canAnalyze: boolean
  analysisText: string
  isTruncated: boolean
  errorText: string
  noticeText: string
  scrollRef: RefObject<HTMLDivElement | null>
  onAnalyze: () => void
  onCancel: () => void
}

export default function AnalysisPanel({
  modes,
  modeLabels,
  mode,
  onModeChange,
  question,
  questionError,
  onQuestionChange,
  isLoading,
  canAnalyze,
  analysisText,
  isTruncated,
  errorText,
  noticeText,
  scrollRef,
  onAnalyze,
  onCancel,
}: AnalysisPanelProps) {
  return (
    <div className="lg:w-[44%] xl:w-[42%] flex flex-col border-t lg:border-t-0 lg:border-l border-white/[0.06] bg-black/20 min-h-0">
      {/* Mode selector */}
      <div className="p-3 border-b border-white/[0.06] flex flex-wrap gap-1.5 flex-shrink-0">
        {modes.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onModeChange(id)}
            disabled={isLoading}
            title={isLoading ? 'Finish or cancel the current analysis first' : MODE_HINTS[id]}
            aria-label={`${label} mode: ${MODE_HINTS[id]}`}
            aria-pressed={mode === id}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
              mode === id
                ? 'bg-rose-500 text-white shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                : 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08] hover:text-gray-300 border border-white/[0.08]'
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Q&A input */}
      <AnimatePresence>
        {mode === 'qa' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden flex-shrink-0"
          >
            <div className="p-3 border-b border-white/[0.06]">
              <input
                type="text"
                value={question}
                onChange={e => onQuestionChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') onAnalyze()
                }}
                placeholder="Ask a question about this image…"
                title="Type a question about the image, then press Enter or Analyze Image"
                aria-label="Question about the image"
                aria-invalid={Boolean(questionError)}
                aria-describedby={questionError ? 'question-error' : undefined}
                className={`w-full bg-white/[0.04] border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-700 focus:outline-none focus:bg-rose-500/[0.03] transition-all duration-200 ${
                  questionError
                    ? 'border-rose-500/70 focus:border-rose-500'
                    : 'border-white/[0.08] focus:border-rose-500/40'
                }`}
              />
              {questionError && (
                <p id="question-error" role="alert" className="mt-1.5 text-xs text-rose-400">
                  {questionError}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Analyze / cancel */}
      <div className="p-3 border-b border-white/[0.06] flex-shrink-0 flex gap-2">
        <button
          onClick={onAnalyze}
          disabled={isLoading || !canAnalyze}
          title={
            isLoading
              ? 'Analysis in progress'
              : `Run ${modeLabels[mode]} on the current image`
          }
          aria-label={`Analyze image in ${modeLabels[mode]} mode`}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-all duration-200 shadow-[0_0_20px_rgba(244,63,94,0.25)] hover:shadow-[0_0_28px_rgba(244,63,94,0.4)]"
        >
          {isLoading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Analyzing</span>
              <LoadingDots />
            </>
          ) : (
            <>
              <Send size={14} />
              <span>Analyze Image</span>
            </>
          )}
        </button>

        {isLoading && (
          <button
            onClick={onCancel}
            title="Stop the analysis and keep whatever has streamed so far"
            aria-label="Cancel analysis"
            className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-gray-300 hover:text-white text-sm font-medium transition-all duration-200"
          >
            <Square size={12} />
            <span>Cancel</span>
          </button>
        )}
      </div>

      {/* Results */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 min-h-0">
        {isLoading && !analysisText ? (
          <div className="space-y-2.5 pt-1" aria-label="Loading analysis" role="status">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="h-2.5 rounded-full bg-white/[0.05] animate-pulse"
                style={{ width: `${92 - i * 8}%` }}
              />
            ))}
          </div>
        ) : analysisText || errorText || noticeText ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {analysisText && <Markdown content={analysisText} streaming={isLoading} />}

            {isTruncated && (
              <div
                role="status"
                className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2.5 text-xs text-amber-300"
              >
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>
                  Output was cut off before the model finished. Crop the image to the section you
                  need, or re-run to capture the rest.
                </span>
              </div>
            )}

            {noticeText && (
              <div
                role="status"
                className="mt-3 flex items-start gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2.5 text-xs text-gray-400"
              >
                <Info size={14} className="mt-0.5 flex-shrink-0" />
                <span>{noticeText}</span>
              </div>
            )}

            {errorText && (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2.5 text-xs text-rose-300"
              >
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{errorText}</span>
              </div>
            )}
          </motion.div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center">
              {(() => {
                const found = modes.find(m => m.id === mode)
                if (!found) return null
                const Icon = found.icon
                return <Icon size={18} className="text-gray-700" />
              })()}
            </div>
            <div>
              <p className="text-gray-600 text-sm">Ready to {modeLabels[mode].toLowerCase()}</p>
              <p className="text-gray-800 text-xs mt-0.5">Press Analyze Image to start</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
