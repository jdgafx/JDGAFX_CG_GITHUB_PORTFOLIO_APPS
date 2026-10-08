import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PICKS, MODEL, PROMPT_MAX_CHARS, SLOTS, type CatalogueResponse, type Slot } from '../netlify/shared/contract'
import { ApiError, fetchCatalogue, isAbortError, runCompare, runJudge } from './lib/api'
import { chooseOption, failedJudgeStep, listed, statusLine, type RunView } from './lib/run'
import { Header } from './components/Header'
import { PromptCard } from './components/PromptCard'
import { PanelSetup, type Picks } from './components/PanelSetup'
import { ResultCard, type CardPhase } from './components/ResultCard'
import { EvidenceCard } from './components/EvidenceCard'
import { JudgeCard } from './components/JudgeCard'
import { TraceCard } from './components/TraceCard'

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.'
}

export default function App() {
  const [prompt, setPrompt] = useState('')
  const [system, setSystem] = useState('')
  // null leaves the model's own temperature in place, so the default request matches the spec.
  const [temperature, setTemperature] = useState<number | null>(null)
  const [catalogue, setCatalogue] = useState<CatalogueResponse | null>(null)
  const [catalogueFailed, setCatalogueFailed] = useState(false)
  const [picks, setPicks] = useState<Picks>(DEFAULT_PICKS)
  const [run, setRun] = useState<RunView | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

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
  const canRun =
    catalogue !== null &&
    listed(catalogue, picks.B) &&
    listed(catalogue, picks.C) &&
    !running &&
    prompt.trim() !== '' &&
    prompt.length <= PROMPT_MAX_CHARS

  async function handleRun() {
    if (!canRun || !catalogue) return
    const controller = new AbortController()
    controllerRef.current = controller
    const sent = prompt
    setRun({ status: 'running', compare: null, judge: { state: 'idle' }, error: null })
    try {
      const compare = await runCompare(
        {
          prompt: sent,
          models: [catalogue.defaultModel, picks.B, picks.C],
          system: system.trim() === '' ? undefined : system,
          temperature: temperature ?? undefined,
        },
        controller.signal,
      )
      const answers = compare.panels.flatMap(p => (p.ok ? [{ slot: p.slot, text: p.text }] : []))
      if (answers.length < 2) {
        setRun({
          status: 'done',
          compare,
          judge: { state: 'skipped', reason: `The judge needs two answers. ${answers.length} of ${SLOTS.length} panels answered.` },
          error: null,
        })
        return
      }
      setRun({ status: 'running', compare, judge: { state: 'running' }, error: null })
      const verdict = await runJudge({ prompt: sent, answers }, controller.signal)
      setRun(prev =>
        prev && {
          ...prev,
          status: 'done',
          judge: verdict.ok
            ? { state: 'done', verdict }
            : { state: 'failed', step: verdict.trace[0], model: verdict.model },
        },
      )
    } catch (err) {
      const stopped = isAbortError(err)
      setRun(prev => {
        if (!prev) return prev
        // Before the panels answered, the whole run failed or stopped.
        if (!prev.compare) {
          return { ...prev, status: stopped ? 'stopped' : 'error', error: stopped ? null : messageFor(err) }
        }
        // The panels answered, so keep them and mark only the judge step.
        return {
          ...prev,
          status: stopped ? 'stopped' : 'done',
          judge: {
            state: 'failed',
            step: failedJudgeStep(stopped ? 'Stopped before the judge answered.' : messageFor(err)),
            model: null,
          },
        }
      })
    } finally {
      controllerRef.current = null
    }
  }

  function handleStop() {
    controllerRef.current?.abort()
  }

  function handleClear() {
    setRun(null)
  }

  const phase: CardPhase = !run
    ? 'idle'
    : run.status === 'running'
      ? 'running'
      : run.status === 'stopped'
        ? 'stopped'
        : run.status === 'error'
          ? 'error'
          : 'done'
  const panels = run?.compare?.panels ?? []
  const scaleMs = panels.length > 0 ? Math.max(0, ...panels.map(p => p.latencyMs ?? 0)) : null
  const requested = (slot: Slot) => (slot === 'A' ? MODEL : picks[slot])

  return (
    <div className="ds-app">
      <Header catalogue={catalogue} catalogueFailed={catalogueFailed} />
      <main className="ds-main">
        <p className="sr-only" role="status" aria-live="polite">
          {statusLine(run)}
        </p>
        <PromptCard
          prompt={prompt}
          onPrompt={setPrompt}
          system={system}
          onSystem={setSystem}
          temperature={temperature}
          onTemperature={setTemperature}
          canRun={canRun}
          running={running}
          hasRun={run !== null}
          onRun={handleRun}
          onStop={handleStop}
          onClear={handleClear}
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
        {run?.error && (
          <div className="ds-notice ds-notice--error" role="alert">
            {run.error}
          </div>
        )}
        {run ? (
          <section className="arena-grid" aria-label="Panel answers">
            {SLOTS.map(slot => (
              <ResultCard
                key={slot}
                slot={slot}
                requested={requested(slot)}
                panel={panels.find(p => p.slot === slot) ?? null}
                phase={phase}
                fastest={run.compare?.summary.fastest?.slot === slot}
                scaleMs={scaleMs}
              />
            ))}
          </section>
        ) : (
          <div className="ds-empty">Run a prompt to see three answers side by side.</div>
        )}
        <EvidenceCard compare={run?.compare ?? null} />
        <JudgeCard judge={run?.judge ?? { state: 'idle' }} compare={run?.compare ?? null} />
        <TraceCard run={run} />
      </main>
      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
