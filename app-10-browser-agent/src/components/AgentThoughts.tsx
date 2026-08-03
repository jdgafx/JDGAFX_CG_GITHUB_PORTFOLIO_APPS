import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, CheckCircle2, Download, FlaskConical, RotateCw, Square } from 'lucide-react'
import type { BotStep, SpeedMode } from '../types'
import { ACTION_META } from '../lib/constants'
import { typingIntervalMs } from '../lib/scenario'

export default function AgentThoughts({
  steps,
  currentStepIndex,
  isRunning,
  completed,
  stopped,
  isSample,
  speed,
  onRestart,
}: {
  steps: BotStep[]
  currentStepIndex: number
  isRunning: boolean
  completed: boolean
  stopped: boolean
  isSample: boolean
  speed: SpeedMode
  onRestart: () => void
}) {
  const currentStep = steps[currentStepIndex]
  const [displayedThought, setDisplayedThought] = useState('')
  const [isTyping, setIsTyping] = useState(false)

  const thought = currentStep?.thought
  useEffect(() => {
    if (!thought) {
      setDisplayedThought('')
      setIsTyping(false)
      return
    }
    setIsTyping(true)
    setDisplayedThought('')
    let i = 0
    const timer = setInterval(() => {
      i++
      setDisplayedThought(thought.slice(0, i))
      if (i >= thought.length) {
        clearInterval(timer)
        setIsTyping(false)
      }
    }, typingIntervalMs(speed, thought.length))
    return () => clearInterval(timer)
  }, [thought, currentStepIndex, speed])

  const resultSteps = steps.filter((s) => (s.action === 'extract' || s.action === 'verify') && s.value)

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
        {isSample && (
          <span
            className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5"
            title="This run is a canned sample scenario, not a result for the task you typed"
          >
            <FlaskConical size={10} />
            Sample
          </span>
        )}
        {isRunning && (
          <div className="ml-auto flex gap-0.5" aria-hidden="true">
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

      <div className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite">
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

        {stopped && !completed && steps.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2"
          >
            <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
              <Square size={14} />
              Run stopped at step {currentStepIndex + 1} of {steps.length}
            </div>
            <p className="text-xs text-amber-200/70">
              The agent was stopped before finishing, so no result was produced.
            </p>
            <button
              onClick={onRestart}
              title="Replay this scenario from the first step"
              aria-label="Restart this scenario from the first step"
              className="flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg px-3 py-1.5 transition-colors"
            >
              <RotateCw size={12} />
              Restart run
            </button>
          </motion.div>
        )}

        {completed && steps.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 space-y-3"
          >
            {isSample ? (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
                  <FlaskConical size={16} />
                  Sample demo finished — not your task
                </div>
                <p className="text-xs text-amber-200/70 mt-1">
                  These are canned values from a built-in flight-search example.
                </p>
              </div>
            ) : (
              <div className="p-3 bg-teal-500/10 border border-teal-500/30 rounded-xl">
                <div className="flex items-center gap-2 text-teal-400 text-sm font-semibold">
                  <CheckCircle2 size={16} />
                  Task completed successfully
                </div>
              </div>
            )}
            {resultSteps.length > 0 && (
              <div
                className={`p-4 bg-slate-800/80 border rounded-xl ${
                  isSample ? 'border-amber-500/20' : 'border-teal-500/20'
                }`}
              >
                <div
                  className={`text-xs font-mono font-semibold uppercase tracking-wider mb-3 flex items-center gap-2 ${
                    isSample ? 'text-amber-500' : 'text-teal-500'
                  }`}
                >
                  <Download size={12} />
                  {isSample ? 'Sample results (not your task)' : 'Results'}
                </div>
                <div className="space-y-2">
                  {resultSteps.map((step, i) => (
                    <div key={i} className="p-3 bg-slate-700/50 rounded-lg border border-slate-600/30">
                      <div className="text-xs text-slate-400 mb-1 uppercase tracking-wide">
                        {step.action === 'extract' ? 'Extracted' : 'Verified'}: {step.target}
                      </div>
                      <div className="text-sm text-white whitespace-pre-wrap leading-relaxed font-mono">
                        {step.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
          <span>
            {steps.length === 0
              ? 'No run yet'
              : `Step ${Math.min(Math.max(currentStepIndex + 1, 1), steps.length)} of ${steps.length}`}
          </span>
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
