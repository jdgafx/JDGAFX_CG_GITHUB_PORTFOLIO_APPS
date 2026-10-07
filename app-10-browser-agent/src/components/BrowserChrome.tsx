import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import type { BotStep, ExecutionResult, SpeedMode } from '../types'
import { typingIntervalMs } from '../lib/scenario'

export default function BrowserChrome({ steps, currentStepIndex, speed, execution }: {
  steps: BotStep[]
  currentStepIndex: number
  speed: SpeedMode
  execution?: ExecutionResult
}) {
  const currentStep = steps[currentStepIndex]
  const [urlText, setUrlText] = useState('')

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
        <div className="h-full overflow-y-auto p-5 bg-slate-950/70">
          {execution?.url ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-teal-400 font-mono">
                <Globe size={14} />
                <span>Observed external page</span>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-2">
                <div className="text-xs text-slate-500 uppercase tracking-wide">URL</div>
                <div className="text-sm text-slate-200 font-mono break-all">{execution.url}</div>
                <div className="text-xs text-slate-500 uppercase tracking-wide pt-2">Title</div>
                <div className="text-sm text-white">{execution.title || 'Untitled page'}</div>
              </div>
              <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
                <div className="text-xs text-teal-400 uppercase tracking-wide mb-2">Observed page content</div>
                <pre className="text-xs leading-relaxed text-slate-300 whitespace-pre-wrap font-mono">{execution.excerpt || 'The page returned no readable text.'}</pre>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-slate-500">
                <Globe size={48} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">Waiting for an external browser session...</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
