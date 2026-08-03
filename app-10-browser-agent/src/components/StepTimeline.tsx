import { motion } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'
import type { BotStep } from '../types'
import { ACTION_META } from '../lib/constants'

export default function StepTimeline({ steps, currentStepIndex }: {
  steps: BotStep[]
  currentStepIndex: number
}) {
  if (steps.length === 0) return null

  return (
    <div className="bg-slate-900/80 rounded-2xl border border-slate-700/50 p-4 overflow-x-auto">
      <div className="relative flex items-center gap-0 min-w-max sm:min-w-0">
        <div className="absolute top-5 left-0 right-0 h-0.5 bg-slate-700 z-0" />
        <motion.div
          className="absolute top-5 left-0 h-0.5 bg-gradient-to-r from-teal-600 to-teal-400 z-0"
          animate={{
            width: `${steps.length === 1 ? 100 : (Math.max(currentStepIndex, 0) / (steps.length - 1)) * 100}%`,
          }}
          transition={{ duration: 0.5 }}
        />

        {steps.map((step, i) => {
          const meta = ACTION_META[step.action]
          const Icon = meta.icon
          const isActive = i === currentStepIndex
          const isDone = i < currentStepIndex

          return (
            <div
              key={i}
              className="flex-1 min-w-[68px] flex flex-col items-center gap-1.5 relative z-10"
              title={`Step ${i + 1} — ${meta.label}: ${step.target}`}
            >
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
