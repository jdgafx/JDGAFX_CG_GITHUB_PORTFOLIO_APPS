import { useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Square, ChevronDown, ChevronUp, Settings, RotateCcw } from 'lucide-react'
import { streamModel } from './lib/api'
import type { ModelResult } from './models'
import { MODELS, createEmptyResult, estimateCost } from './models'
import { Header, PromptSection, ModelSelector, SettingsPanel, WinnerBanner } from './components/Controls'
import { ResponsePanel } from './components/ResponsePanel'

const MAX_SELECTED = 3
const MIN_SELECTED = 2

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
  // Model list frozen at submit time, so changing the selection mid-run or
  // after a run never re-maps the results grid onto the wrong models.
  const [runModels, setRunModels] = useState<string[]>([])
  const [results, setResults] = useState<Record<string, ModelResult>>({})
  const [running, setRunning] = useState(false)
  const [winnerId, setWinnerId] = useState<string | null>(null)
  const abortRefs = useRef<Record<string, AbortController>>({})
  const stoppedRef = useRef(false)

  const toggleModel = (id: string) => {
    setSelectedModels(prev => {
      if (prev.includes(id)) {
        if (prev.length <= MIN_SELECTED) return prev
        return prev.filter(m => m !== id)
      }
      if (prev.length >= MAX_SELECTED) return prev
      return [...prev, id]
    })
  }

  const updateResult = useCallback((modelId: string, patch: Partial<ModelResult>) => {
    setResults(prev => ({
      ...prev,
      [modelId]: { ...(prev[modelId] ?? createEmptyResult()), ...patch },
    }))
  }, [])

  const handleCompare = async () => {
    if (!prompt.trim() || running || selectedModels.length < MIN_SELECTED) return

    Object.values(abortRefs.current).forEach(c => c.abort())
    abortRefs.current = {}
    stoppedRef.current = false

    const modelsToRun = [...selectedModels]
    const startTimes: Record<string, number> = {}
    const initial: Record<string, ModelResult> = {}
    modelsToRun.forEach(id => {
      startTimes[id] = Date.now()
      initial[id] = { ...createEmptyResult(), streaming: true, startTime: startTimes[id] }
    })
    setRunModels(modelsToRun)
    setResults(initial)
    setWinnerId(null)
    setRunning(true)

    const messages = [{ role: 'user' as const, content: prompt }]
    const completed: Record<string, number> = {}

    // A model is only eligible to win if it produced a full response: errors,
    // cancellations and truncations record as ineligible but still settle the run.
    const settle = (modelId: string, latency: number, eligible: boolean) => {
      if (stoppedRef.current) return
      if (modelId in completed) return
      completed[modelId] = eligible ? latency : Infinity
      if (Object.keys(completed).length === modelsToRun.length) {
        const ranked = Object.entries(completed)
          .filter(([, ms]) => Number.isFinite(ms))
          .sort((a, b) => a[1] - b[1])
        setWinnerId(ranked.length > 0 ? ranked[0][0] : null)
        setRunning(false)
      }
    }

    await Promise.allSettled(
      modelsToRun.map(async (modelId) => {
        const ctrl = new AbortController()
        abortRefs.current[modelId] = ctrl

        try {
          await streamModel(
            modelId,
            messages,
            systemPrompt || undefined,
            { temperature, max_tokens: maxTokens },
            (chunk) => {
              if (stoppedRef.current) return

              if (chunk.type === 'text') {
                setResults(prev => {
                  const existing = prev[modelId] ?? createEmptyResult()
                  return {
                    ...prev,
                    [modelId]: { ...existing, text: existing.text + chunk.text },
                  }
                })
                return
              }

              if (chunk.type === 'error') {
                updateResult(modelId, {
                  streaming: false,
                  done: true,
                  error: chunk.message,
                  latencyMs: Date.now() - startTimes[modelId],
                })
                settle(modelId, Infinity, false)
                return
              }

              const latency = chunk.latencyMs ?? Date.now() - startTimes[modelId]
              const reported = typeof chunk.cost === 'number' ? chunk.cost : null
              const cost = reported ?? estimateCost(modelId, chunk.inputTokens, chunk.outputTokens)
              updateResult(modelId, {
                streaming: false,
                done: true,
                latencyMs: latency,
                inputTokens: chunk.inputTokens ?? null,
                outputTokens: chunk.outputTokens ?? null,
                cost,
                costEstimated: reported === null && cost !== null,
                servedModel: chunk.servedModel ?? null,
                truncated: chunk.truncated === true,
                capped: chunk.capped === true,
              })
              settle(modelId, latency, chunk.truncated !== true)
            },
            ctrl.signal,
          )
        } catch (err) {
          if (stoppedRef.current) return
          if ((err as Error).name !== 'AbortError') {
            updateResult(modelId, {
              streaming: false,
              done: true,
              error: (err as Error).message,
              latencyMs: Date.now() - startTimes[modelId],
            })
          }
          settle(modelId, Infinity, false)
        }
      }),
    )
  }

  const handleStop = () => {
    stoppedRef.current = true
    Object.values(abortRefs.current).forEach(c => c.abort())
    abortRefs.current = {}
    setResults(prev => {
      const next = { ...prev }
      runModels.forEach(id => {
        const res = next[id]
        if (res?.streaming) {
          next[id] = {
            ...res,
            streaming: false,
            done: true,
            cancelled: true,
            latencyMs: res.startTime ? Date.now() - res.startTime : res.latencyMs,
          }
        }
      })
      return next
    })
    setWinnerId(null)
    setRunning(false)
  }

  const handleClear = () => {
    stoppedRef.current = true
    Object.values(abortRefs.current).forEach(c => c.abort())
    abortRefs.current = {}
    setResults({})
    setRunModels([])
    setWinnerId(null)
    setRunning(false)
  }

  const hasResults = runModels.length > 0
  const allDone = hasResults && runModels.every(id => results[id]?.done)
  const canRun = prompt.trim().length > 0 && selectedModels.length >= MIN_SELECTED

  return (
    <div className="mesh-bg noise min-h-screen relative">
      <div className="relative z-10 max-w-7xl mx-auto px-4 py-8">
        <Header />
        <div className="mt-3 rounded-xl px-4 py-2" style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.1)' }}>
          <p className="text-xs text-slate-500 leading-relaxed" style={{ margin: 0, maxWidth: 860 }}>
            Pick two or three Claude models, type a prompt, and watch them race. Responses stream in
            side-by-side so you can compare quality, tokens, and cost in real time. When the run
            finishes, the model that returned a complete response in the least time is flagged as the
            fastest response.
          </p>
        </div>

        <div className="mt-5 space-y-4">
          <PromptSection
            prompt={prompt}
            setPrompt={setPrompt}
            systemPrompt={systemPrompt}
            setSystemPrompt={setSystemPrompt}
            showSystem={showSystem}
            setShowSystem={setShowSystem}
            onSubmit={handleCompare}
          />

          <div className="flex flex-col sm:flex-row gap-4">
            <ModelSelector selectedModels={selectedModels} toggleModel={toggleModel} />

            <button
              onClick={() => setShowSettings(s => !s)}
              aria-expanded={showSettings}
              aria-controls="settings-panel"
              title="Adjust temperature and the max output tokens sent to every model"
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
                id="settings-panel"
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

          <div className="flex gap-3 items-center flex-wrap">
            {!running ? (
              <motion.button
                key="compare"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleCompare}
                disabled={!canRun}
                title={
                  canRun
                    ? 'Send the prompt to every selected model and stream the responses side by side'
                    : 'Enter a prompt and select at least two models first'
                }
                className="flex items-center gap-2 px-8 py-3 bg-accent hover:bg-accent-dark text-white rounded-xl font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all glow-blue"
              >
                <Play size={16} fill="currentColor" />
                Compare Models
              </motion.button>
            ) : (
              <motion.button
                key="stop"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleStop}
                title="Cancel every in-flight request and keep whatever text has streamed so far"
                className="flex items-center gap-2 px-8 py-3 bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl font-semibold text-sm hover:bg-red-500/30 transition-all"
              >
                <Square size={16} fill="currentColor" />
                Stop
              </motion.button>
            )}
            {hasResults && !running && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleClear}
                title="Remove the current results and start over"
                className="flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm text-slate-400 hover:text-slate-200 transition-all border border-white/10 hover:border-white/20"
              >
                <RotateCcw size={14} />
                Clear
              </motion.button>
            )}
            {!running && (
              <span className="text-xs text-slate-600 hidden sm:inline" title="Keyboard shortcut for Compare Models">
                Ctrl+Enter to run
              </span>
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
                className={`grid gap-4 mt-4 grid-cols-1 ${
                  runModels.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'
                }`}
              >
                {runModels.map(modelId => {
                  const cfg = MODELS.find(m => m.id === modelId)
                  const res = results[modelId]
                  if (!cfg || !res) return null
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
