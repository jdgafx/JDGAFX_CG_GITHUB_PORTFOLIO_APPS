import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Globe,
  Search,
  MousePointer2,
  Keyboard,
  Download,
  CheckCircle2,
  Bot,
  Play,
  Square,
  ChevronDown,
  Loader2,
  Zap,
  Clock,
  Gauge,
} from 'lucide-react'
import type { BotStep, SpeedMode, StepAction } from './types'
import { generateScenario } from './lib/api'

const PRESETS = [
  'Find cheapest flight NYC to LA next Friday',
  'Extract product data from e-commerce page',
  'Fill out job application form',
  'Compare prices across 3 online stores',
  'Book a restaurant reservation for Saturday 7pm',
]

const ACTION_META: Record<StepAction, { icon: typeof Globe; label: string; color: string }> = {
  navigate: { icon: Globe, label: 'Navigate', color: '#14b8a6' },
  find: { icon: Search, label: 'Find', color: '#06b6d4' },
  click: { icon: MousePointer2, label: 'Click', color: '#8b5cf6' },
  type: { icon: Keyboard, label: 'Type', color: '#f59e0b' },
  extract: { icon: Download, label: 'Extract', color: '#10b981' },
  verify: { icon: CheckCircle2, label: 'Verify', color: '#14b8a6' },
}

const SPEED_DELAYS: Record<SpeedMode, number> = {
  slow: 4000,
  normal: 2500,
  fast: 1200,
}

const DEMO_STEPS: BotStep[] = [
  {
    action: 'navigate',
    target: 'google.com/flights',
    thought: 'Opening Google Flights to search for available routes...',
    url: 'https://google.com/flights',
    pageContent: 'flights-search',
  },
  {
    action: 'find',
    target: 'origin input field',
    thought: 'Locating the departure city input field on the page...',
    url: 'https://google.com/flights',
    pageContent: 'flights-search',
  },
  {
    action: 'click',
    target: 'origin input',
    thought: 'Clicking the origin field to start entering departure city...',
    url: 'https://google.com/flights',
    pageContent: 'flights-search',
  },
  {
    action: 'type',
    target: 'origin input',
    value: 'New York (JFK)',
    thought: 'Typing the departure airport code and city name...',
    url: 'https://google.com/flights',
    pageContent: 'flights-search',
  },
  {
    action: 'find',
    target: 'destination input',
    thought: 'Now searching for the destination field to enter arrival city...',
    url: 'https://google.com/flights',
    pageContent: 'flights-search',
  },
  {
    action: 'type',
    target: 'destination input',
    value: 'Los Angeles (LAX)',
    thought: 'Entering the destination airport — LAX for Los Angeles...',
    url: 'https://google.com/flights',
    pageContent: 'flights-results',
  },
  {
    action: 'click',
    target: 'Search button',
    thought: 'Submitting the search to find available flights...',
    url: 'https://google.com/flights/results',
    pageContent: 'flights-results',
  },
  {
    action: 'extract',
    target: 'flight prices list',
    thought: 'Found 47 results. Extracting price data from the cheapest options...',
    url: 'https://google.com/flights/results',
    pageContent: 'flights-results',
  },
  {
    action: 'verify',
    target: 'cheapest flight',
    value: '$189',
    thought: 'Verified! Cheapest flight is $189 on Spirit Airlines at 6:15 AM.',
    url: 'https://google.com/flights/results',
    pageContent: 'flights-results',
  },
]

function MockPageContent({ pageContent, currentAction, typedText }: {
  pageContent?: string
  currentAction: StepAction
  typedText: string
}) {
  if (pageContent === 'flights-search' || pageContent === 'flights-results') {
    return (
      <div className="p-4 space-y-3">
        <div className="bg-slate-700/50 rounded-xl p-4 space-y-3">
          <div className="flex gap-2 mb-2">
            {['Flights', 'Hotels', 'Car Hire', 'Holidays'].map((tab) => (
              <div
                key={tab}
                className={`px-3 py-1 rounded-full text-xs font-medium ${
                  tab === 'Flights'
                    ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30'
                    : 'text-slate-400'
                }`}
              >
                {tab}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div
              className={`bg-slate-600/60 rounded-lg px-3 py-2 border ${
                currentAction === 'click' || currentAction === 'type'
                  ? 'border-teal-500 shadow-[0_0_12px_rgba(20,184,166,0.3)]'
                  : 'border-slate-500/30'
              }`}
            >
              <div className="text-xs text-slate-400 mb-1">From</div>
              <div className="text-sm text-white font-mono">
                {typedText || 'New York (JFK)'}
                {currentAction === 'type' && typedText.length < 14 && (
                  <span className="cursor-blink text-teal-400">|</span>
                )}
              </div>
            </div>
            <div className="bg-slate-600/60 rounded-lg px-3 py-2 border border-slate-500/30">
              <div className="text-xs text-slate-400 mb-1">To</div>
              <div className="text-sm text-white font-mono">Los Angeles (LAX)</div>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="bg-slate-600/60 rounded-lg px-3 py-2 border border-slate-500/30 flex-1">
              <div className="text-xs text-slate-400 mb-1">Date</div>
              <div className="text-sm text-white">Fri, 28 Feb</div>
            </div>
            <div className="bg-teal-500 rounded-lg px-4 py-2 flex items-center gap-2 text-white text-sm font-semibold">
              <Search size={14} />
              Search
            </div>
          </div>
        </div>

        {pageContent === 'flights-results' && (
          <div className="space-y-2">
            {[
              { airline: 'Spirit Airlines', time: '6:15 AM', price: '$189', badge: 'Cheapest' },
              { airline: 'United Airlines', time: '8:30 AM', price: '$234', badge: '' },
              { airline: 'Delta Air Lines', time: '11:45 AM', price: '$267', badge: '' },
              { airline: 'American Airlines', time: '2:20 PM', price: '$312', badge: '' },
            ].map((flight, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className={`bg-slate-700/60 rounded-lg p-3 flex items-center justify-between border ${
                  i === 0 && currentAction === 'extract'
                    ? 'border-teal-500/60 shadow-[0_0_12px_rgba(20,184,166,0.2)]'
                    : 'border-slate-600/30'
                }`}
              >
                <div>
                  <div className="text-sm font-medium text-white">{flight.airline}</div>
                  <div className="text-xs text-slate-400">{flight.time} · Nonstop</div>
                </div>
                <div className="flex items-center gap-2">
                  {flight.badge && (
                    <span className="text-xs bg-teal-500/20 text-teal-400 px-2 py-0.5 rounded-full border border-teal-500/30">
                      {flight.badge}
                    </span>
                  )}
                  <div className="text-lg font-bold text-white">{flight.price}</div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <div className="h-8 bg-slate-700/60 rounded-lg w-3/4" />
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-slate-700/60 rounded-xl" />
        ))}
      </div>
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-6 bg-slate-700/40 rounded" style={{ width: `${70 + i * 7}%` }} />
        ))}
      </div>
    </div>
  )
}

function BrowserChrome({
  steps,
  currentStepIndex,
  typedText,
}: {
  steps: BotStep[]
  currentStepIndex: number
  typedText: string
}) {
  const currentStep = steps[currentStepIndex]
  const [urlText, setUrlText] = useState('')
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>()
  const [rippleCounter, setRippleCounter] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!currentStep?.url) return
    const url = currentStep.url
    let i = 0
    setUrlText('')
    const timer = setInterval(() => {
      i++
      setUrlText(url.slice(0, i))
      if (i >= url.length) clearInterval(timer)
    }, 30)
    return () => clearInterval(timer)
  }, [currentStep?.url])

  useEffect(() => {
    if (currentStep?.action !== 'click' || !contentRef.current) return
    const rect = contentRef.current.getBoundingClientRect()
    const x = rect.width * 0.4 + Math.random() * rect.width * 0.3
    const y = rect.height * 0.3 + Math.random() * rect.height * 0.3
    const id = rippleCounter
    setRippleCounter((c) => c + 1)
    setRipples((prev) => [...(prev ?? []), { id, x, y }])
    const timer = setTimeout(() => {
      setRipples((prev) => prev?.filter((r) => r.id !== id))
    }, 600)
    return () => clearTimeout(timer)
  }, [currentStep?.action, currentStepIndex, rippleCounter])

  const cursorPositions: Record<StepAction, { x: number; y: number }> = {
    navigate: { x: 50, y: 30 },
    find: { x: 40, y: 45 },
    click: { x: 55, y: 55 },
    type: { x: 42, y: 42 },
    extract: { x: 60, y: 65 },
    verify: { x: 50, y: 50 },
  }

  const cursorPos = currentStep ? cursorPositions[currentStep.action] : { x: 50, y: 50 }

  return (
    <div className="relative h-full bg-slate-900 rounded-2xl overflow-hidden border border-slate-700/50 shadow-2xl">
      <div className="bg-slate-800 px-4 py-3 flex items-center gap-3 border-b border-slate-700/60">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
          <div className="w-3 h-3 rounded-full bg-green-400/80" />
        </div>

        <div className="flex-1 bg-slate-700/60 rounded-lg px-3 py-1.5 flex items-center gap-2 border border-slate-600/30">
          <div className="w-3 h-3 text-teal-500 flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
              <path d="M2 12h20" />
            </svg>
          </div>
          <span className="font-mono text-xs text-slate-300 flex-1 truncate">
            {urlText}
            {urlText.length < (currentStep?.url?.length ?? 0) && (
              <span className="cursor-blink text-teal-400">|</span>
            )}
          </span>
        </div>

        <div className="flex gap-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="w-5 h-5 bg-slate-700/60 rounded" />
          ))}
        </div>
      </div>

      <div ref={contentRef} className="relative overflow-hidden" style={{ height: 'calc(100% - 52px)' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep?.pageContent ?? 'empty'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="h-full overflow-y-auto"
          >
            {currentStep ? (
              <MockPageContent
                pageContent={currentStep.pageContent}
                currentAction={currentStep.action}
                typedText={typedText}
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-slate-500">
                  <Globe size={48} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Waiting for task...</p>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {currentStep && (
          <motion.div
            ref={cursorRef}
            className="absolute w-4 h-4 pointer-events-none z-50"
            animate={{
              left: `${cursorPos.x}%`,
              top: `${cursorPos.y}%`,
            }}
            transition={{ type: 'spring', damping: 20, stiffness: 200 }}
          >
            <div className="relative">
              <div className="w-3 h-3 bg-teal-500 rounded-full shadow-[0_0_8px_rgba(20,184,166,0.8)]" />
              {currentStep.action === 'click' && (
                <motion.div
                  className="absolute inset-0 w-3 h-3 bg-teal-400 rounded-full"
                  animate={{ scale: [1, 2.5], opacity: [0.6, 0] }}
                  transition={{ duration: 0.4, repeat: Infinity, repeatDelay: 0.6 }}
                />
              )}
            </div>
          </motion.div>
        )}

        {(ripples ?? []).map((r) => (
          <motion.div
            key={r.id}
            className="absolute pointer-events-none z-40"
            style={{ left: r.x, top: r.y, transform: 'translate(-50%, -50%)' }}
            initial={{ scale: 0, opacity: 0.8 }}
            animate={{ scale: 3, opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="w-8 h-8 rounded-full border-2 border-teal-400" />
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function AgentThoughts({ steps, currentStepIndex, isRunning }: {
  steps: BotStep[]
  currentStepIndex: number
  isRunning: boolean
}) {
  const currentStep = steps[currentStepIndex]
  const [displayedThought, setDisplayedThought] = useState('')
  const [isTyping, setIsTyping] = useState(false)

  useEffect(() => {
    if (!currentStep?.thought) {
      setDisplayedThought('')
      return
    }
    setIsTyping(true)
    setDisplayedThought('')
    const thought = currentStep.thought
    let i = 0
    const timer = setInterval(() => {
      i++
      setDisplayedThought(thought.slice(0, i))
      if (i >= thought.length) {
        clearInterval(timer)
        setIsTyping(false)
      }
    }, 25)
    return () => clearInterval(timer)
  }, [currentStep?.thought, currentStepIndex])

  return (
    <div className="h-full flex flex-col bg-slate-900/80 rounded-2xl border border-slate-700/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
        <div className="relative">
          <Bot size={18} className="text-teal-500" />
          {isRunning && (
            <motion.div
              className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-teal-400 rounded-full"
              animate={{ scale: [1, 1.4, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          )}
        </div>
        <span className="text-sm font-semibold text-slate-200">Agent Thoughts</span>
        {isRunning && (
          <div className="ml-auto flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-1 h-1 bg-teal-500 rounded-full"
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 0.6, delay: i * 0.15, repeat: Infinity }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {steps.slice(0, currentStepIndex + 1).map((step, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
            className={`flex gap-3 ${i === currentStepIndex ? 'opacity-100' : 'opacity-50'}`}
          >
            <div className="flex-shrink-0 mt-0.5">
              {i < currentStepIndex ? (
                <CheckCircle2 size={14} className="text-teal-500" />
              ) : (
                <div
                  className="w-3.5 h-3.5 rounded-full border-2 border-teal-500 mt-0.5"
                  style={{ backgroundColor: i === currentStepIndex ? 'transparent' : '#14b8a6' }}
                />
              )}
            </div>
            <div className="flex-1">
              <div className="text-xs text-teal-500 font-mono font-semibold uppercase tracking-wider mb-0.5">
                {ACTION_META[step.action].label} · Step {i + 1}
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                {i === currentStepIndex ? displayedThought : step.thought}
                {i === currentStepIndex && isTyping && (
                  <span className="cursor-blink text-teal-400 ml-0.5">▋</span>
                )}
              </p>
            </div>
          </motion.div>
        ))}

        {!isRunning && steps.length > 0 && currentStepIndex >= steps.length - 1 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 p-3 bg-teal-500/10 border border-teal-500/30 rounded-xl"
          >
            <div className="flex items-center gap-2 text-teal-400 text-sm font-semibold">
              <CheckCircle2 size={16} />
              Task completed successfully
            </div>
          </motion.div>
        )}

        {steps.length === 0 && !isRunning && (
          <div className="text-center text-slate-500 py-8">
            <Bot size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Agent ready. Describe a task to begin.</p>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-slate-700/50">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Step {Math.max(currentStepIndex + 1, 0)} of {steps.length || '—'}</span>
          <span className="font-mono text-teal-600">BrowseBot v1.0</span>
        </div>
        {steps.length > 0 && (
          <div className="mt-2 h-1 bg-slate-700 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-teal-600 to-teal-400 rounded-full"
              animate={{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function StepTimeline({ steps, currentStepIndex }: {
  steps: BotStep[]
  currentStepIndex: number
}) {
  if (steps.length === 0) return null

  return (
    <div className="bg-slate-900/80 rounded-2xl border border-slate-700/50 p-4">
      <div className="relative flex items-center gap-0">
        <div className="absolute top-5 left-0 right-0 h-0.5 bg-slate-700 z-0" />
        {steps.length > 1 && (
          <motion.div
            className="absolute top-5 left-0 h-0.5 bg-gradient-to-r from-teal-600 to-teal-400 z-0"
            animate={{ width: `${(currentStepIndex / (steps.length - 1)) * 100}%` }}
            transition={{ duration: 0.5 }}
          />
        )}

        {steps.map((step, i) => {
          const meta = ACTION_META[step.action]
          const Icon = meta.icon
          const isActive = i === currentStepIndex
          const isDone = i < currentStepIndex

          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5 relative z-10">
              <motion.div
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                  isActive
                    ? 'border-teal-500 bg-teal-500/20 shadow-[0_0_16px_rgba(20,184,166,0.4)]'
                    : isDone
                    ? 'border-teal-700 bg-teal-900/40'
                    : 'border-slate-600 bg-slate-800'
                }`}
                animate={isActive ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                transition={{ duration: 1.5, repeat: isActive ? Infinity : 0 }}
              >
                {isDone ? (
                  <CheckCircle2 size={16} className="text-teal-500" />
                ) : (
                  <Icon size={16} className={isActive ? 'text-teal-400' : 'text-slate-500'} />
                )}
              </motion.div>
              <span
                className={`text-xs font-medium ${
                  isActive ? 'text-teal-400' : isDone ? 'text-teal-700' : 'text-slate-600'
                }`}
              >
                {meta.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
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
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const presetRef = useRef<HTMLDivElement>(null)

  const runSteps = useCallback((stepsToRun: BotStep[], startIndex: number, currentSpeed: SpeedMode) => {
    if (startIndex >= stepsToRun.length) {
      setIsRunning(false)
      return
    }

    const step = stepsToRun[startIndex]
    setCurrentStepIndex(startIndex)
    setTypedText('')

    if (step.action === 'type' && step.value) {
      const val = step.value
      let i = 0
      const typeTimer = setInterval(() => {
        i++
        setTypedText(val.slice(0, i))
        if (i >= val.length) clearInterval(typeTimer)
      }, 60)
    }

    stepTimerRef.current = setTimeout(() => {
      runSteps(stepsToRun, startIndex + 1, currentSpeed)
    }, SPEED_DELAYS[currentSpeed])
  }, [])

  const handleRun = async () => {
    if (!task.trim()) return
    setError(null)
    setIsLoading(true)
    setSteps([])
    setCurrentStepIndex(-1)
    setTypedText('')

    try {
      const result = await generateScenario(task)
      setSteps(result)
      setIsRunning(true)
      setIsLoading(false)
      runSteps(result, 0, speed)
    } catch {
      setIsLoading(false)
      setSteps(DEMO_STEPS)
      setIsRunning(true)
      runSteps(DEMO_STEPS, 0, speed)
    }
  }

  const handleStop = () => {
    if (stepTimerRef.current) clearTimeout(stepTimerRef.current)
    setIsRunning(false)
  }

  const handleReset = () => {
    handleStop()
    setSteps([])
    setCurrentStepIndex(-1)
    setTypedText('')
    setError(null)
  }

  useEffect(() => {
    return () => {
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current)
    }
  }, [])

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
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 bg-teal-500 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(20,184,166,0.4)]">
                <Bot size={20} className="text-white" />
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-teal-400 rounded-full border-2 border-slate-900" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">BrowseBot</h1>
              <p className="text-xs text-slate-500">Describe a web task and watch AI plan step-by-step browser automation with simulated clicks, typing, and navigation.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-slate-800/80 rounded-full p-1 border border-slate-700/50">
              {(['slow', 'normal', 'fast'] as SpeedMode[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    speed === s
                      ? 'bg-teal-500 text-white shadow-lg'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {s === 'slow' && <Clock size={11} />}
                  {s === 'normal' && <Gauge size={11} />}
                  {s === 'fast' && <Zap size={11} />}
                  <span className="capitalize">{s}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6 flex-1 flex flex-col gap-4">
        <div className="bg-slate-900/60 rounded-2xl border border-slate-700/50 p-5">
          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-slate-300">Task Description</label>
                <div ref={presetRef} className="relative">
                  <button
                    onClick={() => setShowPresets((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-teal-500 hover:text-teal-400 font-medium transition-colors"
                  >
                    Presets
                    <ChevronDown size={12} className={`transition-transform ${showPresets ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {showPresets && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-6 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden min-w-72"
                      >
                        {PRESETS.map((preset) => (
                          <button
                            key={preset}
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
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Describe what you want the agent to do... e.g. 'Find the cheapest flight from NYC to LA next Friday'"
                rows={2}
                className="w-full bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-teal-500/60 focus:shadow-[0_0_0_3px_rgba(20,184,166,0.1)] transition-all font-mono"
              />
            </div>

            <div className="flex flex-col gap-2 justify-end">
              {!isRunning ? (
                <button
                  onClick={handleRun}
                  disabled={!task.trim() || isLoading}
                  className="flex items-center gap-2 bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-[0_0_20px_rgba(20,184,166,0.3)] hover:shadow-[0_0_30px_rgba(20,184,166,0.5)] active:scale-95"
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
                  className="flex items-center gap-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-semibold px-6 py-3 rounded-xl transition-all"
                >
                  <Square size={16} />
                  Stop
                </button>
              )}
              {steps.length > 0 && (
                <button
                  onClick={handleReset}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex-1 grid grid-cols-5 gap-4" style={{ minHeight: '460px' }}>
          <div className="col-span-3">
            <BrowserChrome
              steps={steps}
              currentStepIndex={currentStepIndex}
              typedText={typedText}
            />
          </div>
          <div className="col-span-2">
            <AgentThoughts
              steps={steps}
              currentStepIndex={currentStepIndex}
              isRunning={isRunning}
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
