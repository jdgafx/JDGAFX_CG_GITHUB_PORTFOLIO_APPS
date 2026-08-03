import { useState } from 'react'
import { motion } from 'framer-motion'
import { Clock, Hash, DollarSign, AlertTriangle, Trophy, Copy, Check } from 'lucide-react'
import type { ModelConfig, ModelResult } from '../models'
import { metricFallback, statusLabel } from '../models'

const COPIED_RESET_MS = 1600

export function ResponsePanel({
  model,
  result,
  isWinner,
}: {
  model: ModelConfig
  result: ModelResult
  isWinner: boolean
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const status = statusLabel(result)
  const fallback = metricFallback(result)

  const dotColor = result.streaming
    ? model.color
    : result.error
      ? '#ef4444'
      : result.cancelled
        ? '#94a3b8'
        : result.truncated
          ? '#f59e0b'
          : result.done
            ? '#22c55e'
            : model.color

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.text)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    setTimeout(() => setCopyState('idle'), COPIED_RESET_MS)
  }

  return (
    <motion.div
      layout
      className={`glass rounded-2xl overflow-hidden flex flex-col transition-all ${isWinner ? 'glow-blue' : ''}`}
      style={isWinner ? { borderColor: model.color + '50' } : {}}
    >
      <div
        className="px-4 py-3 flex items-center justify-between gap-2 border-b border-white/5"
        style={{ borderBottomColor: model.color + '15' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            title={status ? `Status: ${status}` : 'Idle'}
            style={{
              backgroundColor: dotColor,
              animation: result.streaming ? 'glow-pulse 1s ease-in-out infinite' : undefined,
            }}
          />
          <span className="text-sm font-bold text-white truncate">{model.label}</span>
          {isWinner && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 flex-shrink-0"
              title="Returned a complete response in the least time"
              style={{ backgroundColor: model.color + '25', color: model.color }}
            >
              <Trophy size={10} />
              Fastest
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleCopy}
            disabled={!result.text}
            title={result.text ? 'Copy this response to the clipboard' : 'Nothing to copy yet'}
            aria-label={`Copy the ${model.label} response`}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {copyState === 'copied' ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      <span className="sr-only" aria-live="polite">
        {copyState === 'copied' ? 'Response copied' : copyState === 'failed' ? 'Copy failed' : ''}
      </span>

      {result.error && (
        <div className="p-4 text-sm text-red-400 bg-red-500/5 border-b border-red-500/10 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{result.error}</span>
        </div>
      )}

      {result.truncated && !result.error && (
        <div
          className="p-3 text-xs text-amber-400 bg-amber-500/5 border-b border-amber-500/10 flex items-start gap-2"
          title="The serverless request budget ran out before the model finished; shorten the prompt or lower Max Tokens"
        >
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span>Response truncated -- the time budget ran out before this model finished.</span>
        </div>
      )}

      {result.cancelled && !result.error && (
        <div className="p-3 text-xs text-slate-400 bg-white/5 border-b border-white/5">
          Stopped by you -- this response is incomplete.
        </div>
      )}

      <div
        className="flex-1 p-4 min-h-48 max-h-[500px] overflow-y-auto"
        aria-live="polite"
        aria-busy={result.streaming}
        aria-label={`${model.label} response`}
      >
        {result.text ? (
          <p className={`text-sm text-slate-200 leading-relaxed whitespace-pre-wrap ${result.streaming ? 'streaming-cursor' : ''}`}>
            {result.text}
          </p>
        ) : result.streaming ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <span className="streaming-cursor" />
            <span>Generating...</span>
          </div>
        ) : result.done && !result.error ? (
          <p className="text-sm text-slate-500">No text was returned.</p>
        ) : null}
      </div>

      {result.done && (
        <div className="px-4 py-3 border-t border-white/5 space-y-2">
          <div className="grid grid-cols-3 gap-2">
          <Metric
            icon={<Clock size={11} />}
            label="Latency"
            tooltip="Time from request start to the last streamed token"
            value={result.latencyMs !== null ? `${(result.latencyMs / 1000).toFixed(2)}s` : fallback}
            color={model.color}
          />
          <Metric
            icon={<Hash size={11} />}
            label="Tokens"
            tooltip="Output tokens reported by the provider"
            value={result.outputTokens !== null ? `${result.outputTokens}` : fallback}
            color={model.color}
          />
          <Metric
            icon={<DollarSign size={11} />}
            label="Cost"
            tooltip={
              result.cost === null
                ? 'Cost is unavailable for this run'
                : result.costEstimated
                  ? 'Estimated from the local price table -- the provider did not report a cost'
                  : 'Actual cost reported by the provider'
            }
            value={
              result.cost !== null
                ? `${result.costEstimated ? '~' : ''}$${result.cost.toFixed(5)}`
                : fallback
            }
            color={model.color}
          />
          </div>
          <p
            className="text-xs font-mono text-slate-600 truncate"
            title={
              result.servedModel
                ? `The ${model.id} alias resolved to ${result.servedModel} for this run`
                : 'The provider did not report which model snapshot served this request'
            }
          >
            {result.servedModel ? `Served by ${result.servedModel}` : 'Served model not reported'}
          </p>
        </div>
      )}

      {result.streaming && (
        <div className="px-4 py-2 border-t border-white/5">
          <div className="h-0.5 rounded-full overflow-hidden bg-white/5">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: model.color }}
              animate={{ x: ['-100%', '200%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </div>
      )}
    </motion.div>
  )
}

function Metric({
  icon, label, value, color, tooltip,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: string
  tooltip: string
}) {
  return (
    <div className="flex flex-col gap-1" title={tooltip}>
      <div className="flex items-center gap-1" style={{ color }}>
        {icon}
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</span>
      </div>
      <span className="text-xs font-mono font-semibold text-slate-300">{value}</span>
    </div>
  )
}
