import { motion, AnimatePresence } from 'framer-motion'
import { Trophy, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react'
import type { ModelResult } from '../models'
import { MODELS } from '../models'

export function Header() {
  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex items-center justify-between"
    >
      <div className="flex items-center gap-3">
        <div className="relative">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-dark))' }}
          >
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect x="2" y="6" width="12" height="20" rx="2.5" stroke="#fff" strokeWidth="1.5" fill="rgba(255,255,255,0.15)"/>
              <rect x="18" y="6" width="12" height="20" rx="2.5" stroke="#93c5fd" strokeWidth="1.5" fill="rgba(147,197,253,0.15)"/>
              <path d="M8 12h0M8 16h0M8 20h0" stroke="#fff" strokeWidth="3" strokeLinecap="round"/>
              <path d="M24 12h0M24 16h0M24 20h0" stroke="#93c5fd" strokeWidth="3" strokeLinecap="round"/>
              <path d="M14 16h4" stroke="#93c5fd" strokeWidth="1.5" strokeDasharray="2 2"/>
            </svg>
          </div>
          <div
            className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-[#0a0e1a] glow-pulse"
            style={{ backgroundColor: '#22c55e' }}
          />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            Model<span style={{ color: 'var(--color-accent)' }}>Arena</span>
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Multi-Model LLM Playground
          </p>
        </div>
      </div>
      <div
        className="hidden sm:flex items-center gap-2 text-xs text-slate-500"
        title="Responses are streamed token by token as each model generates them"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 glow-pulse" />
        Live Streaming
      </div>
    </motion.header>
  )
}

export function PromptSection({
  prompt, setPrompt, systemPrompt, setSystemPrompt, showSystem, setShowSystem, onSubmit,
}: {
  prompt: string
  setPrompt: (v: string) => void
  systemPrompt: string
  setSystemPrompt: (v: string) => void
  showSystem: boolean
  setShowSystem: (v: boolean) => void
  onSubmit: () => void
}) {
  return (
    <div className="glass rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <label
          htmlFor="prompt-input"
          className="text-xs font-semibold text-slate-400 uppercase tracking-widest"
          title="The message sent to every selected model"
        >
          Prompt
        </label>
        <button
          onClick={() => setShowSystem(!showSystem)}
          aria-expanded={showSystem}
          aria-controls="system-prompt-field"
          title={showSystem ? 'Hide the system prompt field' : 'Add a system prompt applied to every model'}
          className="text-xs text-slate-500 hover:text-blue-400 transition-colors flex items-center gap-1"
        >
          {showSystem ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          System Prompt
        </button>
      </div>

      <AnimatePresence>
        {showSystem && (
          <motion.div
            id="system-prompt-field"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <label htmlFor="system-prompt-input" className="sr-only">
              System prompt
            </label>
            <textarea
              id="system-prompt-input"
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              placeholder="Optional system prompt..."
              title="Optional instructions prepended to the conversation for every model"
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 placeholder-slate-600 resize-none focus:outline-none focus:border-blue-500/50 transition-colors font-mono"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <textarea
        id="prompt-input"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Enter your prompt to compare models side by side..."
        title="Type a prompt, then press Ctrl+Enter or Compare Models to run it against every selected model"
        rows={4}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-blue-500/50 transition-colors"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSubmit()
          }
        }}
      />
    </div>
  )
}

export function ModelSelector({
  selectedModels,
  toggleModel,
}: {
  selectedModels: string[]
  toggleModel: (id: string) => void
}) {
  return (
    <div className="flex-1 flex items-center gap-2 flex-wrap" role="group" aria-label="Models to compare">
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest mr-1">
        Models:
      </span>
      {MODELS.map(m => {
        const selected = selectedModels.includes(m.id)
        const atMax = !selected && selectedModels.length >= 3
        const atMin = selected && selectedModels.length <= 2
        return (
          <motion.button
            key={m.id}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => toggleModel(m.id)}
            aria-pressed={selected}
            title={
              atMax
                ? 'Deselect another model first -- three is the maximum'
                : atMin
                  ? 'At least two models are needed for a comparison'
                  : selected
                    ? `Remove ${m.label} from this comparison`
                    : `Add ${m.label} to this comparison`
            }
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
              selected
                ? 'text-white border-transparent'
                : 'text-slate-500 border-white/10 glass-hover'
            } ${atMax || atMin ? 'opacity-60 cursor-not-allowed' : ''}`}
            style={selected ? { backgroundColor: m.color + '33', borderColor: m.color + '66', color: m.color } : {}}
          >
            {selected && <CheckCircle2 size={12} />}
            {m.shortName}
          </motion.button>
        )
      })}
      <span className="text-xs text-slate-600 ml-2" title="Pick two or three models per run">
        {selectedModels.length}/3 selected
      </span>
    </div>
  )
}

export function SettingsPanel({
  temperature,
  setTemperature,
  maxTokens,
  setMaxTokens,
}: {
  temperature: number
  setTemperature: (v: number) => void
  maxTokens: number
  setMaxTokens: (v: number) => void
}) {
  return (
    <div className="glass rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-6">
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label
            htmlFor="temperature-input"
            className="text-xs font-semibold text-slate-400 uppercase tracking-widest"
            title="Lower values give repeatable answers, higher values give more varied ones"
          >
            Temperature
          </label>
          <span className="text-xs font-mono text-blue-400">{temperature.toFixed(2)}</span>
        </div>
        <input
          id="temperature-input"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={temperature}
          onChange={e => setTemperature(parseFloat(e.target.value))}
          title="Sampling temperature, 0 (precise) to 1 (creative)"
          aria-label="Temperature"
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-slate-600">
          <span>Precise</span>
          <span>Creative</span>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label
            htmlFor="max-tokens-input"
            className="text-xs font-semibold text-slate-400 uppercase tracking-widest"
            title="Upper bound on the length of each response"
          >
            Max Tokens
          </label>
          <span className="text-xs font-mono text-blue-400">{maxTokens.toLocaleString()}</span>
        </div>
        <input
          id="max-tokens-input"
          type="range"
          min="256"
          max="4096"
          step="256"
          value={maxTokens}
          onChange={e => setMaxTokens(parseInt(e.target.value))}
          title="Maximum output tokens per model, 256 to 4096"
          aria-label="Max tokens"
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-slate-600">
          <span>256</span>
          <span>4096</span>
        </div>
      </div>
    </div>
  )
}

export function WinnerBanner({
  winnerId,
  results,
}: {
  winnerId: string
  results: Record<string, ModelResult>
}) {
  const model = MODELS.find(m => m.id === winnerId)
  const res = results[winnerId]
  if (!model || !res) return null

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative overflow-hidden glass rounded-2xl p-4 flex items-center gap-4 border"
      title="The model that returned a complete response in the least time"
      style={{ borderColor: model.color + '40' }}
    >
      <div className="absolute inset-0 winner-shimmer opacity-30" />
      <div
        className="relative w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: model.color + '20' }}
      >
        <Trophy size={20} style={{ color: model.color }} />
      </div>
      <div className="relative">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Fastest Response</p>
        <p className="font-bold text-white">
          {model.label}
          {res.latencyMs !== null && (
            <span className="text-sm font-normal text-slate-400 ml-2">
              {(res.latencyMs / 1000).toFixed(2)}s
            </span>
          )}
        </p>
      </div>
    </motion.div>
  )
}
