import { useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Trophy, Clock, Hash, DollarSign, Play, Square,
  ChevronDown, ChevronUp, Settings, Cpu, CheckCircle2
} from 'lucide-react'
import { streamModel } from './lib/api'

interface ModelConfig {
  id: string
  name: string
  label: string
  shortName: string
  color: string
  costPer1kInput: number
  costPer1kOutput: number
}

interface ModelResult {
  text: string
  latencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  cost: number | null
  streaming: boolean
  done: boolean
  error: string | null
  startTime: number | null
}

const MODELS: ModelConfig[] = [
  {
    id: 'claude-haiku-4.5',
    name: 'claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    shortName: 'Haiku 4.5',
    color: '#f59e0b',
    costPer1kInput: 0.001,
    costPer1kOutput: 0.005,
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    shortName: 'Sonnet 4.6',
    color: '#3b82f6',
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  {
    id: 'claude-sonnet-4',
    name: 'claude-sonnet-4',
    label: 'Claude Sonnet 4',
    shortName: 'Sonnet 4',
    color: '#8b5cf6',
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
]

function createEmptyResult(): ModelResult {
  return {
    text: '',
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    cost: null,
    streaming: false,
    done: false,
    error: null,
    startTime: null,
  }
}

export default function App() {
  const [prompt, setPrompt] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(1024)
  const [selectedModels, setSelectedModels] = useState<string[]>([
    'claude-haiku-4.5',
    'claude-sonnet-4.6',
  ])
  const [results, setResults] = useState<Record<string, ModelResult>>({})
  const [running, setRunning] = useState(false)
  const [winnerId, setWinnerId] = useState<string | null>(null)
  const abortRefs = useRef<Record<string, AbortController>>({})

  const toggleModel = (id: string) => {
    setSelectedModels(prev => {
      if (prev.includes(id)) {
        if (prev.length <= 2) return prev
        return prev.filter(m => m !== id)
      }
      if (prev.length >= 3) return prev
      return [...prev, id]
    })
  }

  const updateResult = useCallback((modelId: string, patch: Partial<ModelResult>) => {
    setResults(prev => ({
      ...prev,
      [modelId]: { ...prev[modelId], ...patch },
    }))
  }, [])

  const handleCompare = async () => {
    if (!prompt.trim() || running) return

    Object.values(abortRefs.current).forEach(c => c.abort())
    abortRefs.current = {}

    const initial: Record<string, ModelResult> = {}
    selectedModels.forEach(id => {
      initial[id] = { ...createEmptyResult(), streaming: true, startTime: Date.now() }
    })
    setResults(initial)
    setWinnerId(null)
    setRunning(true)

    const messages = [{ role: 'user' as const, content: prompt }]
    const completedTimes: Record<string, number> = {}

    const checkDone = (modelId: string, latency: number) => {
      completedTimes[modelId] = latency
      if (Object.keys(completedTimes).length === selectedModels.length) {
        const fastest = Object.entries(completedTimes).sort((a, b) => a[1] - b[1])[0][0]
        setWinnerId(fastest)
        setRunning(false)
      }
    }

    await Promise.allSettled(
      selectedModels.map(async (modelId) => {
        const ctrl = new AbortController()
        abortRefs.current[modelId] = ctrl

        try {
          await streamModel(
            modelId,
            messages,
            systemPrompt || undefined,
            { temperature, max_tokens: maxTokens },
            (chunk: import('./lib/api').StreamChunk) => {
              if (chunk.type === 'text') {
                setResults(prev => ({
                  ...prev,
                  [modelId]: {
                    ...prev[modelId],
                    text: prev[modelId].text + chunk.text,
                  },
                }))
              } else if (chunk.type === 'done') {
                const latency = chunk.latencyMs ?? (Date.now() - (initial[modelId].startTime ?? Date.now()))
                const cfg = MODELS.find(m => m.id === modelId)!
                const cost = cfg
                  ? ((chunk.inputTokens ?? 0) / 1000 * cfg.costPer1kInput) +
                    ((chunk.outputTokens ?? 0) / 1000 * cfg.costPer1kOutput)
                  : 0
                updateResult(modelId, {
                  streaming: false,
                  done: true,
                  latencyMs: latency,
                  inputTokens: chunk.inputTokens ?? null,
                  outputTokens: chunk.outputTokens ?? null,
                  cost,
                })
                checkDone(modelId, latency)
              }
            },
            ctrl.signal,
          )
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            updateResult(modelId, {
              streaming: false,
              done: true,
              error: (err as Error).message,
            })
            checkDone(modelId, Infinity)
          }
        }
      }),
    )
  }

  const handleStop = () => {
    Object.values(abortRefs.current).forEach(c => c.abort())
    abortRefs.current = {}
    selectedModels.forEach(id => {
      if (results[id]?.streaming) {
        updateResult(id, { streaming: false, done: true })
      }
    })
    setRunning(false)
  }

  const hasResults = Object.keys(results).length > 0
  const allDone = hasResults && selectedModels.every(id => results[id]?.done)

  return (
    <div className="mesh-bg noise min-h-screen relative">
      <div className="relative z-10 max-w-7xl mx-auto px-4 py-8">
        <Header />

        <div className="mt-8 space-y-4">
          <PromptSection
            prompt={prompt}
            setPrompt={setPrompt}
            systemPrompt={systemPrompt}
            setSystemPrompt={setSystemPrompt}
            showSystem={showSystem}
            setShowSystem={setShowSystem}
          />

          <div className="flex flex-col sm:flex-row gap-4">
            <ModelSelector selectedModels={selectedModels} toggleModel={toggleModel} />

            <button
              onClick={() => setShowSettings(s => !s)}
              className="glass glass-hover flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:text-slate-200 transition-all"
            >
              <Settings size={15} />
              Settings
              {showSettings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>

          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <SettingsPanel
                  temperature={temperature}
                  setTemperature={setTemperature}
                  maxTokens={maxTokens}
                  setMaxTokens={setMaxTokens}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex gap-3">
            {!running ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleCompare}
                disabled={!prompt.trim() || selectedModels.length < 2}
                className="flex items-center gap-2 px-8 py-3 bg-accent text-white rounded-xl font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all glow-blue hover:bg-blue-500"
                style={{ backgroundColor: '#3b82f6' }}
              >
                <Play size={16} fill="currentColor" />
                Compare Models
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleStop}
                className="flex items-center gap-2 px-8 py-3 bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl font-semibold text-sm hover:bg-red-500/30 transition-all"
              >
                <Square size={16} fill="currentColor" />
                Stop
              </motion.button>
            )}
          </div>
        </div>

        <AnimatePresence>
          {hasResults && (
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="mt-8"
            >
              {allDone && winnerId && (
                <WinnerBanner winnerId={winnerId} results={results} />
              )}
              <div
                className="grid gap-4 mt-4"
                style={{ gridTemplateColumns: `repeat(${selectedModels.length}, 1fr)` }}
              >
                {selectedModels.map(modelId => {
                  const cfg = MODELS.find(m => m.id === modelId)!
                  const res = results[modelId]
                  if (!res) return null
                  return (
                    <ResponsePanel
                      key={modelId}
                      model={cfg}
                      result={res}
                      isWinner={winnerId === modelId}
                    />
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <footer className="text-center py-4 text-xs text-slate-600">
          Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
        </footer>
      </div>
    </div>
  )
}

function Header() {
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
            style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
          >
            <Cpu size={20} className="text-white" />
          </div>
          <div
            className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-[#0a0e1a] glow-pulse"
            style={{ backgroundColor: '#22c55e' }}
          />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            Model<span style={{ color: '#3b82f6' }}>Arena</span>
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Compare Claude AI models side by side. Send the same prompt to multiple models and see which responds faster and better.
          </p>
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 glow-pulse" />
        Live Streaming
      </div>
    </motion.header>
  )
}

function PromptSection({
  prompt, setPrompt, systemPrompt, setSystemPrompt, showSystem, setShowSystem,
}: {
  prompt: string
  setPrompt: (v: string) => void
  systemPrompt: string
  setSystemPrompt: (v: string) => void
  showSystem: boolean
  setShowSystem: (v: boolean) => void
}) {
  return (
    <div className="glass rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
          Prompt
        </label>
        <button
          onClick={() => setShowSystem(!showSystem)}
          className="text-xs text-slate-500 hover:text-blue-400 transition-colors flex items-center gap-1"
        >
          {showSystem ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          System Prompt
        </button>
      </div>

      <AnimatePresence>
        {showSystem && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              placeholder="Optional system prompt..."
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 placeholder-slate-600 resize-none focus:outline-none focus:border-blue-500/50 transition-colors font-mono"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Enter your prompt to compare models side by side..."
        rows={4}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-blue-500/50 transition-colors"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
          }
        }}
      />
    </div>
  )
}

function ModelSelector({
  selectedModels,
  toggleModel,
}: {
  selectedModels: string[]
  toggleModel: (id: string) => void
}) {
  return (
    <div className="flex-1 flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest mr-1">
        Models:
      </span>
      {MODELS.map(m => {
        const selected = selectedModels.includes(m.id)
        return (
          <motion.button
            key={m.id}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => toggleModel(m.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
              selected
                ? 'text-white border-transparent'
                : 'text-slate-500 border-white/10 glass-hover'
            }`}
            style={selected ? { backgroundColor: m.color + '33', borderColor: m.color + '66', color: m.color } : {}}
          >
            {selected && <CheckCircle2 size={12} />}
            {m.shortName}
          </motion.button>
        )
      })}
      <span className="text-xs text-slate-600 ml-2">
        {selectedModels.length}/3 selected
      </span>
    </div>
  )
}

function SettingsPanel({
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
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Temperature
          </label>
          <span className="text-xs font-mono text-blue-400">{temperature.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={temperature}
          onChange={e => setTemperature(parseFloat(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-slate-600">
          <span>Precise</span>
          <span>Creative</span>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Max Tokens
          </label>
          <span className="text-xs font-mono text-blue-400">{maxTokens.toLocaleString()}</span>
        </div>
        <input
          type="range"
          min="256"
          max="4096"
          step="256"
          value={maxTokens}
          onChange={e => setMaxTokens(parseInt(e.target.value))}
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

function WinnerBanner({ winnerId, results }: { winnerId: string; results: Record<string, ModelResult> }) {
  const model = MODELS.find(m => m.id === winnerId)
  const res = results[winnerId]
  if (!model) return null

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative overflow-hidden glass rounded-2xl p-4 flex items-center gap-4 border"
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
          {res.latencyMs && (
            <span className="text-sm font-normal text-slate-400 ml-2">
              {(res.latencyMs / 1000).toFixed(2)}s
            </span>
          )}
        </p>
      </div>
    </motion.div>
  )
}

function ResponsePanel({
  model,
  result,
  isWinner,
}: {
  model: ModelConfig
  result: ModelResult
  isWinner: boolean
}) {
  return (
    <motion.div
      layout
      className={`glass rounded-2xl overflow-hidden flex flex-col transition-all ${isWinner ? 'glow-blue' : ''}`}
      style={isWinner ? { borderColor: model.color + '50' } : {}}
    >
      <div
        className="px-4 py-3 flex items-center justify-between border-b border-white/5"
        style={{ borderBottomColor: model.color + '15' }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              backgroundColor: result.streaming ? model.color : result.done && !result.error ? '#22c55e' : '#ef4444',
              animation: result.streaming ? 'glow-pulse 1s ease-in-out infinite' : undefined,
            }}
          />
          <span className="text-sm font-bold text-white">{model.label}</span>
          {isWinner && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: model.color + '25', color: model.color }}
            >
              🏆 Fastest
            </span>
          )}
        </div>
        <span className="text-xs font-mono text-slate-600">{model.id.split('-').slice(-1)[0]}</span>
      </div>

      {result.error && (
        <div className="p-4 text-sm text-red-400 bg-red-500/5 border-b border-red-500/10">
          ⚠ {result.error}
        </div>
      )}

      <div className="flex-1 p-4 min-h-48 max-h-[500px] overflow-y-auto">
        {result.text ? (
          <p className={`text-sm text-slate-200 leading-relaxed whitespace-pre-wrap ${result.streaming ? 'streaming-cursor' : ''}`}>
            {result.text}
          </p>
        ) : result.streaming ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <span className="streaming-cursor" />
            <span>Generating...</span>
          </div>
        ) : null}
      </div>

      {result.done && (
        <div className="px-4 py-3 border-t border-white/5 grid grid-cols-3 gap-2">
          <Metric
            icon={<Clock size={11} />}
            label="Latency"
            value={result.latencyMs ? `${(result.latencyMs / 1000).toFixed(2)}s` : '—'}
            color={model.color}
          />
          <Metric
            icon={<Hash size={11} />}
            label="Tokens"
            value={result.outputTokens ? `${result.outputTokens}` : '—'}
            color={model.color}
          />
          <Metric
            icon={<DollarSign size={11} />}
            label="Cost"
            value={result.cost !== null ? `$${result.cost.toFixed(5)}` : '—'}
            color={model.color}
          />
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
  icon, label, value, color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1" style={{ color }}>
        {icon}
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</span>
      </div>
      <span className="text-xs font-mono font-semibold text-slate-300">{value}</span>
    </div>
  )
}
