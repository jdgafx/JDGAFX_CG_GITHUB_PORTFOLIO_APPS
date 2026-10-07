import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Gauge,
  Loader2,
  Play,
  RotateCw,
  Square,
  Zap,
} from 'lucide-react'
import type { BotStep, SpeedMode } from './types'
import { executeScenario, generateScenario } from './lib/api'
import { PRESETS, SPEED_HINTS } from './lib/constants'
import type { ExecutionEvent, ExecutionResult } from './types'
import BrowserChrome from './components/BrowserChrome'
import AgentThoughts from './components/AgentThoughts'
import StepTimeline from './components/StepTimeline'

const SPEED_ICONS: Record<SpeedMode, typeof Clock> = {
  slow: Clock,
  normal: Gauge,
  fast: Zap,
}

export default function App() {
  const [task, setTask] = useState('')
  const [steps, setSteps] = useState<BotStep[]>([])
  const [currentStepIndex, setCurrentStepIndex] = useState(-1)
  const [isRunning, setIsRunning] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [speed, setSpeed] = useState<SpeedMode>('normal')
  const [error, setError] = useState<string | null>(null)
  const [showPresets, setShowPresets] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [servedModel, setServedModel] = useState('')
  const [execution, setExecution] = useState<ExecutionResult | undefined>()
  const abortRef = useRef<AbortController | null>(null)
  const presetRef = useRef<HTMLDivElement>(null)
  const startRun = useCallback(async (stepsToRun: BotStep[], model: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setCompleted(false)
    setStopped(false)
    setError(null)
    setSteps(stepsToRun)
    setCurrentStepIndex(-1)
    setExecution(undefined)
    setIsRunning(true)
    try {
      await executeScenario(stepsToRun, model, (event: ExecutionEvent) => {
        if (event.type === 'session') setExecution({ sessionId: event.sessionId })
        if (event.type === 'step_start') setCurrentStepIndex(event.index)
        if (event.type === 'step_complete') setExecution((previous) => ({ ...previous, url: event.url, title: event.title, excerpt: event.excerpt }))
        if (event.type === 'result') setExecution((previous) => ({ ...previous, url: event.url, title: event.title, excerpt: event.excerpt }))
        if (event.type === 'error') setError(event.message)
        if (event.type === 'done') setCompleted(true)
      }, controller.signal)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'The external browser could not be reached.')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setIsRunning(false)
    }
  }, [])

  const handleRun = async () => {
    const trimmed = task.trim()
    if (!trimmed) return
    abortRef.current?.abort()
    setError(null)
    setCompleted(false)
    setStopped(false)
    setIsRunning(false)
    setIsLoading(true)
    setSteps([])
    setCurrentStepIndex(-1)
    setExecution(undefined)

    try {
      const result = await generateScenario(trimmed)
      setIsLoading(false)
      setServedModel(result.servedModel)
      await startRun(result.steps, result.servedModel)
    } catch (err) {
      setIsLoading(false)
      setError(err instanceof Error ? err.message : 'The planning service could not be reached.')
    }
  }

  const handleRestart = () => {
    if (steps.length > 0) void startRun(steps, servedModel)
  }

  const handleStop = () => {
    abortRef.current?.abort()
    setIsRunning(false)
    setStopped(steps.length > 0 && !completed)
  }

  const handleReset = () => {
    abortRef.current?.abort()
    setIsRunning(false)
    setSteps([])
    setCurrentStepIndex(-1)
    setExecution(undefined)
    setError(null)
    setCompleted(false)
    setStopped(false)
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (presetRef.current && !presetRef.current.contains(e.target as Node)) {
        setShowPresets(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0f1a] flex flex-col">
      <header className="border-b border-slate-800/60 bg-slate-900/60 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 bg-teal-500 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(20,184,166,0.4)]">
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                  <rect x="3" y="5" width="26" height="18" rx="3" stroke="#fff" strokeWidth="1.5" fill="rgba(255,255,255,0.1)"/>
                  <line x1="3" y1="10" x2="29" y2="10" stroke="#fff" strokeWidth="1" opacity="0.3"/>
                  <circle cx="7" cy="7.5" r="1.2" fill="#f43f5e"/>
                  <circle cx="11" cy="7.5" r="1.2" fill="#fbbf24"/>
                  <circle cx="15" cy="7.5" r="1.2" fill="#22c55e"/>
                  <path d="M20 26l3-3 3 3" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M23 23v-6" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round"/>
                  <rect x="8" y="14" width="10" height="2" rx="1" fill="#fff" opacity="0.3"/>
                  <rect x="8" y="18" width="6" height="2" rx="1" fill="#fff" opacity="0.2"/>
                </svg>
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-teal-400 rounded-full border-2 border-slate-900" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">BrowseBot</h1>
              <p className="text-xs text-slate-500">Browser Task Planner</p>
            </div>
          </div>

          <div
            role="radiogroup"
            aria-label="Animation speed"
            className="flex items-center gap-1 bg-slate-800/80 rounded-full p-1 border border-slate-700/50"
          >
            {(['slow', 'normal', 'fast'] as SpeedMode[]).map((s) => {
              const Icon = SPEED_ICONS[s]
              return (
                <button
                  key={s}
                  role="radio"
                  aria-checked={speed === s}
                  aria-label={SPEED_HINTS[s]}
                  title={SPEED_HINTS[s]}
                  onClick={() => setSpeed(s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    speed === s
                      ? 'bg-teal-700 text-white shadow-lg'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Icon size={11} />
                  <span className="capitalize">{s}</span>
                </button>
              )
            })}
          </div>
        </div>
      </header>
      <div className="border-b border-slate-800/40 px-6 py-2" style={{ background: 'rgba(20,184,166,0.02)' }}>
        <p className="max-w-7xl mx-auto text-xs text-slate-500 leading-relaxed" style={{ margin: 0 }}>
          Describe a web task — 'find the cheapest flight' or 'search Google for Browserbase' — and watch a bounded Browserbase session execute the approved plan on a real external website. The UI shows observed URLs, titles, page text, step rationale, and recoverable limits.
        </p>
      </div>

      <div className="max-w-7xl mx-auto w-full px-6 py-6 flex-1 flex flex-col gap-4">
        <div className="bg-slate-900/60 rounded-2xl border border-slate-700/50 p-5">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-2 min-w-0">
              <div className="flex items-center justify-between">
                <label htmlFor="task-input" className="text-sm font-semibold text-slate-300">
                  Task Description
                </label>
                <div ref={presetRef} className="relative">
                  <button
                    onClick={() => setShowPresets((v) => !v)}
                    title="Pick an example task to fill the box"
                    aria-label="Show example tasks"
                    aria-haspopup="menu"
                    aria-expanded={showPresets}
                    className="flex items-center gap-1.5 text-xs text-teal-500 hover:text-teal-400 font-medium transition-colors"
                  >
                    Presets
                    <ChevronDown size={12} className={`transition-transform ${showPresets ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {showPresets && (
                      <motion.div
                        role="menu"
                        initial={{ opacity: 0, y: -8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-6 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden w-[min(18rem,calc(100vw-3rem))]"
                      >
                        {PRESETS.map((preset) => (
                          <button
                            key={preset}
                            role="menuitem"
                            title={`Use this task: ${preset}`}
                            onClick={() => {
                              setTask(preset)
                              setShowPresets(false)
                            }}
                            className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors border-b border-slate-700/40 last:border-0"
                          >
                            {preset}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <textarea
                id="task-input"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (task.trim() && !isRunning && !isLoading) handleRun()
                  }
                }}
                title="Describe the web task in plain English. Enter runs it, Shift+Enter adds a line."
                placeholder="Describe the browser workflow to plan... e.g. 'Find the cheapest flight from NYC to LA next Friday' (Enter to run, Shift+Enter for new line)"
                rows={2}
                className="w-full bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-teal-500/60 focus:shadow-[0_0_0_3px_rgba(20,184,166,0.1)] transition-all font-mono"
              />
            </div>

            <div className="flex flex-row sm:flex-col gap-2 sm:justify-end items-stretch">
              {!isRunning ? (
                <button
                  onClick={handleRun}
                  disabled={!task.trim() || isLoading}
                  title={task.trim() ? 'Generate a plan for this task' : 'Enter a task first'}
                  aria-label="Generate a browser workflow plan"
                  className="flex items-center justify-center gap-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-[0_0_20px_rgba(20,184,166,0.3)] hover:shadow-[0_0_30px_rgba(20,184,166,0.5)] active:scale-95"
                >
                  {isLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Play size={16} />
                  )}
                  {isLoading ? 'Planning...' : 'Generate Plan'}
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  title="Stop the run where it is"
                  aria-label="Stop planning"
                  className="flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-semibold px-6 py-3 rounded-xl transition-all"
                >
                  <Square size={16} />
                  Stop
                </button>
              )}
              {steps.length > 0 && !isRunning && (
                <button
                  onClick={handleRestart}
                  title="Replay this scenario from step 1"
                  aria-label="Replay the current scenario from the first step"
                  className="flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-teal-400 border border-slate-700/60 hover:border-teal-500/40 rounded-lg px-3 py-2 transition-colors"
                >
                  <RotateCw size={12} />
                  Replay
                </button>
              )}
              {steps.length > 0 && (
                <button
                  onClick={handleReset}
                  title="Clear the run, the page and the results"
                  aria-label="Clear the current run and results"
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg space-y-2"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-red-400" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-red-400">
                    Agent run failed — nothing was produced for your task.
                  </div>
                  <div className="mt-1 text-[11px] font-mono text-red-300/80 break-words">{error}</div>
                </div>
              </div>
              {!isRunning && !isLoading && (
                <div className="flex flex-wrap gap-2 pl-6">
                  <button
                    onClick={handleRun}
                    disabled={!task.trim()}
                    title="Send the same task to the agent again"
                    aria-label="Retry the plan"
                    className="flex items-center gap-1.5 text-xs font-semibold text-red-300 hover:text-red-200 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 border border-red-500/30 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    <RotateCw size={12} />
                    Retry
                  </button>
                </div>
              )}
            </div>
          )}

        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-5 gap-4 md:min-h-[460px]">
          <div className="md:col-span-3 min-h-[420px] md:min-h-0">
            <BrowserChrome
              steps={steps}
              currentStepIndex={currentStepIndex}
              speed={speed}
              execution={execution}
            />
          </div>
          <div className="md:col-span-2 min-h-[360px] md:min-h-0">
            <AgentThoughts
              steps={steps}
              currentStepIndex={currentStepIndex}
              isRunning={isRunning}
              completed={completed}
              stopped={stopped}
              speed={speed}
              onRestart={handleRestart}
              execution={execution}
              servedModel={servedModel}
            />
          </div>
        </div>

        {steps.length > 0 && (
          <StepTimeline steps={steps} currentStepIndex={currentStepIndex} />
        )}
      </div>
      <footer className="text-center py-3 text-xs text-slate-600 border-t border-slate-800/40">
        Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
      </footer>
    </div>
  )
}
