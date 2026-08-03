import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Globe } from 'lucide-react'
import type { BotStep, SpeedMode } from '../types'
import { cursorPositionFor, fieldKeyForTarget, fieldValuesAt, scenarioResultRows, typingIntervalMs } from '../lib/scenario'
import MockPageContent from './MockPageContent'

const RIPPLE_LIFETIME_MS = 600

export default function BrowserChrome({ steps, currentStepIndex, typedText, speed }: {
  steps: BotStep[]
  currentStepIndex: number
  typedText: string
  speed: SpeedMode
}) {
  const currentStep = steps[currentStepIndex]
  const [urlText, setUrlText] = useState('')
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])
  const rippleCounterRef = useRef(0)

  const cursorPos = currentStep
    ? cursorPositionFor(currentStep.action, currentStepIndex)
    : { x: 50, y: 50 }

  const url = currentStep?.url
  useEffect(() => {
    if (!url) return
    let i = 0
    setUrlText('')
    const timer = setInterval(() => {
      i++
      setUrlText(url.slice(0, i))
      if (i >= url.length) clearInterval(timer)
    }, typingIntervalMs(speed, url.length))
    return () => clearInterval(timer)
  }, [url, speed])

  useEffect(() => {
    if (currentStep?.action !== 'click') return
    const id = rippleCounterRef.current++
    setRipples((prev) => [...prev, { id, x: cursorPos.x, y: cursorPos.y }])
    const timer = setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id))
    }, RIPPLE_LIFETIME_MS)
    return () => clearTimeout(timer)
  }, [currentStep?.action, currentStepIndex, cursorPos.x, cursorPos.y])

  const fields = useMemo(
    () => fieldValuesAt(steps, currentStepIndex, typedText),
    [steps, currentStepIndex, typedText],
  )
  const rows = useMemo(() => scenarioResultRows(steps), [steps])

  const activeField =
    currentStep && (currentStep.action === 'type' || currentStep.action === 'find' || currentStep.action === 'click')
      ? fieldKeyForTarget(currentStep.target)
      : null

  return (
    <div className="relative h-full bg-slate-900 rounded-2xl overflow-hidden border border-slate-700/50 shadow-2xl">
      <div className="bg-slate-800 px-4 py-3 flex items-center gap-3 border-b border-slate-700/60">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
          <div className="w-3 h-3 rounded-full bg-green-400/80" />
        </div>

        <div className="flex-1 min-w-0 bg-slate-700/60 rounded-lg px-3 py-1.5 flex items-center gap-2 border border-slate-600/30">
          <div className="w-3 h-3 text-teal-500 flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
              <path d="M2 12h20" />
            </svg>
          </div>
          <span className="font-mono text-xs text-slate-300 flex-1 truncate" title={currentStep?.url ?? ''}>
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

      <div className="relative overflow-hidden" style={{ height: 'calc(100% - 52px)' }}>
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
                activeField={activeField}
                fields={fields}
                rows={rows}
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

        {ripples.map((r) => (
          <motion.div
            key={r.id}
            className="absolute pointer-events-none z-40"
            style={{ left: `${r.x}%`, top: `${r.y}%`, transform: 'translate(-50%, -50%)' }}
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
