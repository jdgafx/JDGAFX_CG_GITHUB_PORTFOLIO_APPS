import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PICKS, MODEL, PROMPT_MAX_CHARS, SLOTS, type CatalogueResponse, type Slot } from '../netlify/shared/contract'
import { ApiError, fetchCatalogue, isAbortError, runCompare, runJudge } from './lib/api'
import { chooseOption, failedJudgeStep, listed, statusLine, type RunView } from './lib/run'
import { Header } from './components/Header'
import { PromptCard, SAMPLE_PROMPT } from './components/PromptCard'
import { PanelSetup, type Picks } from './components/PanelSetup'
import { RunActions } from './components/RunActions'
import { ResultCard, type CardPhase } from './components/ResultCard'
import { EvidenceCard } from './components/EvidenceCard'
import { JudgeCard } from './components/JudgeCard'
import { RunTotalsStrip } from './components/RunTotals'
import { TraceCard } from './components/TraceCard'

const IDLE_STATUS = 'Enter a prompt, then choose Compare models.'

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.'
}

// The first thing that stops a run, so the disabled button can say what to do next.
function blockedReason(catalogue: CatalogueResponse | null, picks: Picks, prompt: string): string | null {
  if (catalogue === null) return 'Wait for the model list to load.'
  if (!listed(catalogue, picks.B) || !listed(catalogue, picks.C)) return 'Choose panel B and C models from the list.'
  if (prompt.trim() === '') return 'Enter a prompt, or use the sample prompt.'
  if (prompt.length > PROMPT_MAX_CHARS) {
    return `Shorten the prompt to ${PROMPT_MAX_CHARS.toLocaleString('en-US')} characters or fewer.`
  }
  return null
}

// The status line's words. After an error the alert carries the message, so the line does not repeat it.
function statusText(run: RunView | null): string {
  if (!run) return IDLE_STATUS
  if (run.status === 'error') return 'Comparison did not finish.'
  return statusLine(run)
}

// The status dot follows the run's state, and the status line's words say the same thing.
function statusDot(run: RunView | null): string {
  if (!run) return ''
  if (run.status === 'running') return 'ds-dot--running'
  if (run.status === 'error') return 'ds-dot--failed'
  if (run.status === 'stopped') return 'ds-dot--skipped'
  const allAnswered = run.compare?.panels.every(p => p.ok) ?? false
  return allAnswered ? 'ds-dot--ok' : 'arena-dot--warn'
}

// The slot the judge named best, or null for a tie or when there is no verdict.
function judgePickOf(run: RunView | null): Slot | null {
  const judge = run?.judge
  if (judge?.state !== 'done') return null
  return judge.verdict.bestOverall === 'tie' ? null : judge.verdict.bestOverall
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
  const blocked = blockedReason(catalogue, picks, prompt)
  const canRun = !running && blocked === null

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
  const fastestSlot = run?.compare?.summary.fastest?.slot ?? null
  const cheapestSlot = run?.compare?.summary.cheapest?.slot ?? null
  const pickSlot = judgePickOf(run)
  const dot = statusDot(run)

  return (
    <div className="ds-app">
      <Header catalogue={catalogue} catalogueFailed={catalogueFailed} />
      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <PromptCard
              prompt={prompt}
              onPrompt={setPrompt}
              onSample={() => setPrompt(SAMPLE_PROMPT)}
              system={system}
              onSystem={setSystem}
              temperature={temperature}
              onTemperature={setTemperature}
              running={running}
              onRun={handleRun}
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
            <RunActions
              canRun={canRun}
              running={running}
              hasRun={run !== null}
              blockedBy={running ? null : blocked}
              onRun={handleRun}
              onStop={handleStop}
              onClear={handleClear}
            />
          </div>

          <div className="ds-run">
            <p className="arena-status" role="status" aria-live="polite">
              {dot && <span className={`ds-dot ${dot}`} aria-hidden="true" />}
              {statusText(run)}
            </p>
            {run?.error && (
              <div className="ds-notice ds-notice--error" role="alert">
                {run.error}
              </div>
            )}
            <section className="ds-section" aria-labelledby="answers-title">
              <div className="ds-section__head">
                <h2 className="ds-section__title" id="answers-title">
                  Answers
                </h2>
                <p className="ds-section__sub">
                  Each panel shows the model that served it, its answer, and the figures measured for that call.
                </p>
              </div>
              <div className="arena-grid">
                {SLOTS.map(slot => (
                  <ResultCard
                    key={slot}
                    slot={slot}
                    requested={requested(slot)}
                    panel={panels.find(p => p.slot === slot) ?? null}
                    phase={phase}
                    fastest={fastestSlot === slot}
                    cheapest={cheapestSlot === slot}
                    judgePick={pickSlot === slot}
                    scaleMs={scaleMs}
                  />
                ))}
              </div>
            </section>
            <EvidenceCard compare={run?.compare ?? null} />
            <JudgeCard judge={run?.judge ?? { state: 'idle' }} compare={run?.compare ?? null} />
            <RunTotalsStrip run={run} />
            <TraceCard run={run} />
          </div>
        </div>
      </main>
      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
