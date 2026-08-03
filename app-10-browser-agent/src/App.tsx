import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  FlaskConical,
  Gauge,
  Loader2,
  Play,
  RotateCw,
  Square,
  Zap,
} from 'lucide-react'
import type { BotStep, SpeedMode } from './types'
import { generateScenario } from './lib/api'
import { PRESETS, SPEED_DELAYS, SPEED_HINTS, SPEED_POLL_MS } from './lib/constants'
import { typingIntervalMs } from './lib/scenario'
import { SAMPLE_STEPS } from './lib/sample'
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
  const [typedText, setTypedText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showPresets, setShowPresets] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [isSample, setIsSample] = useState(false)
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const presetRef = useRef<HTMLDivElement>(null)
  const speedRef = useRef(speed)

  useEffect(() => { speedRef.current = speed }, [speed])

  const clearTimers = useCallback(() => {
    if (stepTimerRef.current) {
      clearTimeout(stepTimerRef.current)
      stepTimerRef.current = null
    }
    if (typeTimerRef.current) {
      clearInterval(typeTimerRef.current)
      typeTimerRef.current = null
    }
  }, [])

  const runSteps = useCallback((stepsToRun: BotStep[], startIndex: number) => {
    if (startIndex >= stepsToRun.length) {
      setIsRunning(false)
      setCompleted(true)
      return
    }

    const step = stepsToRun[startIndex]
    setCurrentStepIndex(startIndex)
    setTypedText('')

    if (typeTimerRef.current) {
      clearInterval(typeTimerRef.current)
      typeTimerRef.current = null
    }
    if (step.action === 'type' && step.value) {
      const val = step.value
      let i = 0
      typeTimerRef.current = setInterval(() => {
        i++
        setTypedText(val.slice(0, i))
        if (i >= val.length && typeTimerRef.current) {
          clearInterval(typeTimerRef.current)
          typeTimerRef.current = null
        }
      }, typingIntervalMs(speedRef.current, val.length))
    }

    // Poll rather than schedule the full delay up front, so a speed change mid-step applies now.
    const startedAt = Date.now()
    const tick = () => {
      const delay = SPEED_DELAYS[speedRef.current]
      const remaining = delay - (Date.now() - startedAt)
      if (remaining <= 0) {
        runSteps(stepsToRun, startIndex + 1)
        return
      }
      stepTimerRef.current = setTimeout(tick, Math.min(SPEED_POLL_MS, remaining))
    }
    stepTimerRef.current = setTimeout(tick, SPEED_POLL_MS)
  }, [])

  const startRun = useCallback((stepsToRun: BotStep[], sample: boolean) => {
    clearTimers()
    setCompleted(false)
    setStopped(false)
    setIsSample(sample)
    setSteps(stepsToRun)
    setCurrentStepIndex(-1)
    setTypedText('')
    setIsRunning(true)
    runSteps(stepsToRun, 0)
  }, [clearTimers, runSteps])

  const handleRun = async () => {
    const trimmed = task.trim()
    if (!trimmed) return
    clearTimers()
    setError(null)
    setCompleted(false)
    setStopped(false)
    setIsSample(false)
    setIsRunning(false)
    setIsLoading(true)
    setSteps([])
    setCurrentStepIndex(-1)
    setTypedText('')

    try {
      const result = await generateScenario(trimmed)
      setIsLoading(false)
      startRun(result, false)
    } catch (err) {
      setIsLoading(false)
      setError(err instanceof Error ? err.message : 'The agent service could not be reached.')
    }
  }

  const handleRunSample = () => startRun(SAMPLE_STEPS, true)

  const handleRestart = () => {
    if (steps.length > 0) startRun(steps, isSample)
  }

  const handleStop = () => {
    clearTimers()
    setIsRunning(false)
    setStopped(steps.length > 0 && !completed)
  }

  const handleReset = () => {
    clearTimers()
    setIsRunning(false)
    setSteps([])
    setCurrentStepIndex(-1)
    setTypedText('')
    setError(null)
    setCompleted(false)
    setStopped(false)
    setIsSample(false)
  }

  useEffect(() => clearTimers, [clearTimers])

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
              <p className="text-xs text-slate-500">AI Browser Agent Demo</p>
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
                      ? 'bg-teal-500 text-white shadow-lg'
                      : 'text-slate-400 hover:text-slate-200'
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
          Describe a web task — 'find the cheapest flight' or 'fill out this form' — and watch an autonomous browser agent work through it step by step. You'll see the cursor move, buttons get clicked, text get typed, and a running log of what the agent is thinking at each point.
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
                placeholder="Describe what you want the agent to do... e.g. 'Find the cheapest flight from NYC to LA next Friday' (Enter to run, Shift+Enter for new line)"
                rows={2}
                className="w-full bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-teal-500/60 focus:shadow-[0_0_0_3px_rgba(20,184,166,0.1)] transition-all font-mono"
              />
            </div>

            <div className="flex flex-row sm:flex-col gap-2 sm:justify-end items-stretch">
              {!isRunning ? (
                <button
                  onClick={handleRun}
                  disabled={!task.trim() || isLoading}
                  title={task.trim() ? 'Run the agent on this task' : 'Enter a task first'}
                  aria-label="Run agent on the task described above"
                  className="flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-[0_0_20px_rgba(20,184,166,0.3)] hover:shadow-[0_0_30px_rgba(20,184,166,0.5)] active:scale-95"
                >
                  {isLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Play size={16} />
                  )}
                  {isLoading ? 'Loading...' : 'Run Agent'}
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  title="Stop the run where it is"
                  aria-label="Stop the running agent"
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
                    aria-label="Retry the agent run"
                    className="flex items-center gap-1.5 text-xs font-semibold text-red-300 hover:text-red-200 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 border border-red-500/30 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    <RotateCw size={12} />
                    Retry
                  </button>
                  <button
                    onClick={handleRunSample}
                    title="Play a built-in flight-search example — canned data, not a result for your task"
                    aria-label="Play the built-in sample demo, which is not a result for your task"
                    className="flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    <FlaskConical size={12} />
                    Sample demo (not your task)
                  </button>
                </div>
              )}
            </div>
          )}

          {isSample && (
            <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2">
              <FlaskConical size={14} className="mt-0.5 flex-shrink-0 text-amber-400" />
              <div className="text-xs text-amber-300">
                <span className="font-semibold">Sample demo (not your task).</span>{' '}
                This is a canned flight-search scenario with fixed data, shown only to demonstrate the animation.
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-5 gap-4 md:min-h-[460px]">
          <div className="md:col-span-3 min-h-[420px] md:min-h-0">
            <BrowserChrome
              steps={steps}
              currentStepIndex={currentStepIndex}
              typedText={typedText}
              speed={speed}
            />
          </div>
          <div className="md:col-span-2 min-h-[360px] md:min-h-0">
            <AgentThoughts
              steps={steps}
              currentStepIndex={currentStepIndex}
              isRunning={isRunning}
              completed={completed}
              stopped={stopped}
              isSample={isSample}
              speed={speed}
              onRestart={handleRestart}
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
