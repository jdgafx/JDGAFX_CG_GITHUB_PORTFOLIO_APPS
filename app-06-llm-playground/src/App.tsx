import { useEffect, useRef, useState } from 'react'
import { fetchCatalogue, isAbortError } from './lib/api'
import { blockedReason, chooseOption, DEFAULT_PICKS, statusText, type Mode, type Picks, type RunView } from './lib/run'
import { useArena } from './lib/useArena'
import type { CatalogueResponse } from '../netlify/shared/contract'
import { AnswersSection } from './components/AnswersSection'
import { EvidenceCard } from './components/EvidenceCard'
import { Header } from './components/Header'
import { JudgeCard } from './components/JudgeCard'
import { Leaderboard } from './components/Leaderboard'
import { PanelSetup } from './components/PanelSetup'
import { PromptCard, SAMPLES } from './components/PromptCard'
import { RunActions } from './components/RunActions'
import { RunTotalsStrip } from './components/RunTotals'
import { TraceCard } from './components/TraceCard'

// The shell's run state: voting is a finished comparison waiting on the visitor, so it reads as done.
function dataRun(run: RunView | null): 'idle' | 'running' | 'done' | 'failed' | 'stopped' {
  if (!run) return 'idle'
  if (run.status === 'running') return 'running'
  if (run.status === 'error') return 'failed'
  if (run.status === 'stopped') return 'stopped'
  return 'done'
}

export default function App() {
  const [prompt, setPrompt] = useState(SAMPLES[0].prompt)
  const [system, setSystem] = useState('')
  // null leaves the model's own temperature in place, so the default request matches the spec.
  const [temperature, setTemperature] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode>('blind')
  const [catalogue, setCatalogue] = useState<CatalogueResponse | null>(null)
  const [catalogueFailed, setCatalogueFailed] = useState(false)
  const [picks, setPicks] = useState<Picks>(DEFAULT_PICKS)
  const arena = useArena(catalogue)
  const { run } = arena

  useEffect(() => {
    const controller = new AbortController()
    fetchCatalogue(controller.signal)
      .then(loaded => {
        setCatalogue(loaded)
        setPicks(prev => ({ B: chooseOption(loaded, prev.B), C: chooseOption(loaded, prev.C) }))
      })
      .catch(err => {
        if (!isAbortError(err)) setCatalogueFailed(true)
      })
    return () => controller.abort()
  }, [])

  const running = run?.status === 'running'
  const startScroll = useRef(0)
  const previousStatus = useRef<RunView['status'] | null>(null)
  const previousVote = useRef(false)

  // On a narrow screen a finished, failed or stopped run brings its result into view and focuses the heading,
  // unless the visitor scrolled during the run. A counted vote does the same for the reveal.
  useEffect(() => {
    const was = previousStatus.current
    const status = run?.status ?? null
    const counted = run?.vote.state === 'counted'
    previousStatus.current = status
    const wasCounted = previousVote.current
    previousVote.current = counted
    const ended = was === 'running' && status !== null && status !== 'running'
    const revealed = counted && !wasCounted
    if (!ended && !revealed) return
    const target = document.querySelector<HTMLElement>(revealed ? '[data-reveal-focus]' : '[data-result-focus]')
    if (!target) return
    const narrow = !window.matchMedia('(min-width: 1000px)').matches
    const scrolled = ended && Math.abs(window.scrollY - startScroll.current) > 40
    if (narrow && !scrolled) {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      target.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
    }
    target.focus({ preventScroll: true })
  }, [run?.status, run?.vote.state])
  const blocked = blockedReason(catalogue, picks, prompt, system)
  const canRun = !running && blocked === null

  function handleRun() {
    if (!canRun) return
    startScroll.current = window.scrollY
    // An open sample or options list would push the result off a narrow screen, so close them as the run starts.
    if (!window.matchMedia('(min-width: 1000px)').matches) {
      document.querySelectorAll<HTMLDetailsElement>('.ds-controls details[open]').forEach(d => (d.open = false))
    }
    void arena.start({ mode, prompt, system, temperature, models: [picks.B, picks.C] })
  }

  const voted = run?.vote.state === 'counted' ? run.vote.changes : []

  return (
    <div className="ds-app" data-run={dataRun(run)}>
      <Header catalogue={catalogue} catalogueFailed={catalogueFailed} run={run} />
      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <PromptCard
              prompt={prompt}
              onPrompt={setPrompt}
              system={system}
              onSystem={setSystem}
              temperature={temperature}
              onTemperature={setTemperature}
              mode={mode}
              onMode={setMode}
              running={running}
              onRun={handleRun}
            />
            <RunActions
              mode={mode}
              canRun={canRun}
              running={running}
              hasRun={run !== null}
              blockedBy={running ? null : blocked}
              onStop={arena.stop}
              onClear={arena.clear}
            />
            {catalogueFailed && (
              <div className="ds-notice ds-notice--error" role="alert">
                The model list could not be loaded. Reload the page to try again.
              </div>
            )}
            <PanelSetup
              catalogue={catalogue}
              catalogueFailed={catalogueFailed}
              picks={picks}
              onPick={(slot, id) => setPicks(prev => ({ ...prev, [slot]: id }))}
              disabled={running || catalogue === null}
            />
          </div>

          <div className="ds-run">
            <p className="ds-sr-only" role="status" aria-live="polite">{statusText(run, blocked)}</p>
            <Leaderboard state={arena.board} changes={voted} onRetry={() => void arena.refreshBoard()} />
            <RunTotalsStrip run={run} />
            <div className="ds-run__result arena-result">
              <AnswersSection run={run} picks={picks} onVote={choice => void arena.vote(choice)} onRetry={handleRun} canRetry={canRun} />
              <JudgeCard
                judge={run?.judge ?? { state: 'idle' }}
                compare={run?.compare ?? null}
                held={run?.status === 'voting'}
              />
            </div>
            <div className="ds-run__trace arena-result">
              <EvidenceCard compare={run?.compare ?? null} />
              <TraceCard run={run} />
            </div>
          </div>
        </div>
      </main>
      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
