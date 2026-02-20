import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, ListTree, PenTool, CheckCircle, Sparkles,
  Play, ChevronDown, ChevronUp, Copy, Check, Loader2,
} from 'lucide-react'
import { runPipeline, type StepId } from './lib/api'

interface StepState {
  id: StepId
  label: string
  status: 'pending' | 'active' | 'complete'
  content: string
}

const STEP_META: { id: StepId; label: string; icon: typeof Search }[] = [
  { id: 'research', label: 'Research', icon: Search },
  { id: 'outline', label: 'Outline', icon: ListTree },
  { id: 'draft', label: 'Draft', icon: PenTool },
  { id: 'edit', label: 'Edit', icon: CheckCircle },
  { id: 'polish', label: 'Polish', icon: Sparkles },
]

const CONTENT_TYPES = ['Blog Post', 'Technical Article', 'Marketing Copy', 'Newsletter', 'Social Thread']

function makeInitialSteps(): StepState[] {
  return STEP_META.map(m => ({ id: m.id, label: m.label, status: 'pending' as const, content: '' }))
}

export default function App() {
  const [topic, setTopic] = useState('')
  const [contentType, setContentType] = useState('Blog Post')
  const [steps, setSteps] = useState<StepState[]>(makeInitialSteps)
  const [isRunning, setIsRunning] = useState(false)
  const [expandedStep, setExpandedStep] = useState<StepId | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollTop = activeRef.current.scrollHeight
    }
  })

  const activeStep = steps.find(s => s.status === 'active')
  const lastComplete = [...steps].reverse().find(s => s.status === 'complete')

  const handleRun = useCallback(async () => {
    if (!topic.trim() || isRunning) return
    setIsRunning(true)
    setError('')
    setSteps(makeInitialSteps())
    setExpandedStep(null)

    await runPipeline(topic, contentType, {
      onStepStart(step) {
        setSteps(prev => prev.map(s => s.id === step ? { ...s, status: 'active', content: '' } : s))
      },
      onStepChunk(step, chunk) {
        setSteps(prev => prev.map(s => s.id === step ? { ...s, content: s.content + chunk } : s))
      },
      onStepComplete(step) {
        setSteps(prev => prev.map(s => s.id === step ? { ...s, status: 'complete' } : s))
      },
      onPipelineComplete() {
        setIsRunning(false)
      },
      onError(msg) {
        setError(msg)
        setIsRunning(false)
      },
    })
  }, [topic, contentType, isRunning])

  const handleCopy = useCallback(() => {
    const final = steps.find(s => s.id === 'polish')
    if (final?.content) {
      void navigator.clipboard.writeText(final.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [steps])

  const completedSteps = steps.filter(s => s.status === 'complete')
  const allDone = completedSteps.length === 5

  return (
    <div className="min-h-screen bg-surface text-slate-200">
      <header className="border-b border-white/5 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-lime-500/10">
              <Sparkles className="h-5 w-5 text-lime-400" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">ContentForge</h1>
          </div>
          {allDone && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 rounded-lg bg-lime-500/10 px-4 py-2 text-sm font-medium text-lime-400 transition hover:bg-lime-500/20"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied!' : 'Copy Final'}
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row">
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void handleRun()}
            placeholder="Enter a topic... e.g. 'The Future of AI in Healthcare'"
            className="flex-1 rounded-xl border border-white/10 bg-surface-raised px-4 py-3 text-white placeholder-slate-500 outline-none transition focus:border-lime-500/50 focus:ring-1 focus:ring-lime-500/30"
            disabled={isRunning}
          />
          <select
            value={contentType}
            onChange={e => setContentType(e.target.value)}
            className="rounded-xl border border-white/10 bg-surface-raised px-4 py-3 text-white outline-none transition focus:border-lime-500/50"
            disabled={isRunning}
          >
            {CONTENT_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            onClick={() => void handleRun()}
            disabled={!topic.trim() || isRunning}
            className="flex items-center justify-center gap-2 rounded-xl bg-lime-500 px-6 py-3 font-semibold text-black transition hover:bg-lime-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isRunning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
            {isRunning ? 'Running...' : 'Generate'}
          </button>
        </div>

        <div className="mb-8 flex items-center justify-between gap-2 overflow-x-auto rounded-xl border border-white/5 bg-surface-raised p-4">
          {STEP_META.map((meta, i) => {
            const step = steps[i]
            if (!step) return null
            const Icon = meta.icon
            const isActive = step.status === 'active'
            const isDone = step.status === 'complete'
            return (
              <div key={meta.id} className="flex items-center gap-2">
                {i > 0 && (
                  <div className={`mx-2 h-px w-8 transition-colors duration-500 ${isDone || isActive ? 'bg-lime-500' : 'bg-white/10'}`} />
                )}
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  isActive ? 'bg-lime-500/15 text-lime-400' :
                  isDone ? 'text-lime-400/70' :
                  'text-slate-500'
                }`}>
                  <div className="relative">
                    <Icon className="h-4 w-4" />
                    {isActive && (
                      <motion.div
                        className="absolute -inset-1.5 rounded-full border border-lime-500/40"
                        animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                      />
                    )}
                  </div>
                  <span className="hidden sm:inline">{meta.label}</span>
                  {isDone && <Check className="h-3.5 w-3.5 text-lime-500" />}
                </div>
              </div>
            )
          })}
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-red-400">
            {error}
          </div>
        )}

        <AnimatePresence mode="wait">
          {activeStep && (
            <motion.div
              key={activeStep.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="mb-6 rounded-xl border border-lime-500/10 bg-surface-raised"
            >
              <div className="flex items-center gap-2 border-b border-white/5 px-5 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-lime-400" />
                <span className="text-sm font-medium text-lime-400">
                  {activeStep.label}
                </span>
              </div>
              <div ref={activeRef} className="max-h-80 overflow-y-auto p-5">
                <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-slate-300">
                  {activeStep.content}
                  <motion.span
                    className="inline-block h-4 w-0.5 bg-lime-400"
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {completedSteps.length > 0 && (
          <div className="space-y-3">
            {completedSteps.map(step => {
              const meta = STEP_META.find(m => m.id === step.id)
              if (!meta) return null
              const Icon = meta.icon
              const isExpanded = expandedStep === step.id
              return (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-white/5 bg-surface-raised overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedStep(isExpanded ? null : step.id)}
                    className="flex w-full items-center justify-between px-5 py-3 text-left transition hover:bg-white/[0.02]"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-lime-400/70" />
                      <span className="text-sm font-medium text-slate-300">{step.label}</span>
                      <Check className="h-3.5 w-3.5 text-lime-500" />
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-slate-500" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-500" />
                    )}
                  </button>
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="max-h-96 overflow-y-auto border-t border-white/5 p-5">
                          <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-slate-400">
                            {step.content}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        )}

        {!isRunning && !activeStep && completedSteps.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-lime-500/5">
              <Sparkles className="h-8 w-8 text-lime-500/30" />
            </div>
            <h2 className="mb-2 text-lg font-medium text-slate-400">Ready to create</h2>
            <p className="max-w-md text-sm text-slate-500">
              Enter a topic above and ContentForge will research, outline, draft, edit, and polish your content through a 5-step AI pipeline.
            </p>
          </div>
        )}

        {allDone && lastComplete && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 rounded-xl border border-lime-500/20 bg-lime-500/5 p-6"
          >
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-lime-400" />
              <h3 className="text-lg font-semibold text-white">Final Output</h3>
            </div>
            <div className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-slate-300">
              {lastComplete.content}
            </div>
          </motion.div>
        )}
      </main>
    </div>
  )
}
