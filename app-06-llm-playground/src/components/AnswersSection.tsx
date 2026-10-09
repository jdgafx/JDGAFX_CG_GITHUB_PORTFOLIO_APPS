import { MODEL, SLOTS, type Slot, type VoteChoice } from '../../netlify/shared/contract'
import { formatDelta, splitModel } from '../lib/format'
import type { Picks, RunView } from '../lib/run'
import { BlindAnswers } from './BlindAnswers'
import { ResultCard, type CardPhase } from './ResultCard'

interface AnswersSectionProps {
  run: RunView | null
  picks: Picks
  onVote: (choice: VoteChoice) => void
  onRetry: () => void
  canRetry: boolean
}

function phaseOf(run: RunView | null): CardPhase {
  if (!run) return 'idle'
  if (run.status === 'running') return 'running'
  if (run.status === 'stopped') return 'stopped'
  if (run.status === 'error') return 'error'
  return 'done'
}

export function AnswersSection({ run, picks, onVote, onRetry, canRetry }: AnswersSectionProps) {
  return (
    <section className="ds-section" aria-labelledby="answers-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 className="ds-section__title" id="answers-title" tabIndex={-1} data-result-focus>Answers</h2>
        <p className="ds-section__sub">{subtitle(run)}</p>
      </div>
      <Body run={run} picks={picks} onVote={onVote} onRetry={onRetry} canRetry={canRetry} />
    </section>
  )
}

function subtitle(run: RunView | null): string {
  if (run?.status === 'voting') return 'Read all three, then pick the best. The models are named when you vote.'
  if (run?.vote.state === 'counted') return 'Models revealed. Each panel shows the model that served it and what the call measured.'
  if (run?.mode === 'blind') return 'Blind mode shuffles the panels and hides the models until you vote.'
  return 'Each panel shows the model that served it, its answer, and the figures measured for that call.'
}

function Body({ run, picks, onVote, onRetry, canRetry }: AnswersSectionProps) {
  if (!run) {
    return (
      <div className="ds-state ds-state--empty">
        <span className="ds-state__mark" aria-hidden="true" />
        <p className="ds-state__title">Nothing to compare yet</p>
        <p className="ds-state__body">
          Choose Compare blind. Three models answer the prompt, you read the answers without names, and your vote moves the
          leaderboard.
        </p>
      </div>
    )
  }
  if (run.status === 'running' && !run.compare) {
    return (
      <div className="ds-state ds-state--loading" aria-busy="true">
        <span className="ds-state__mark" aria-hidden="true" />
        <p className="ds-state__title">Asking three models</p>
        <p className="ds-state__body">
          {run.mode === 'blind' ? 'The answers arrive together, under the shuffled labels A, B and C.' : 'Each answer appears when its panel finishes.'}
        </p>
        <div className="ds-skeleton" aria-hidden="true"><span /><span /><span /></div>
      </div>
    )
  }
  if (run.status === 'error') {
    return (
      <div className="ds-state ds-state--error" role="alert">
        <span className="ds-state__mark" aria-hidden="true" />
        <p className="ds-state__title">The comparison did not finish</p>
        <p className="ds-state__body">{run.error ?? 'The comparison failed.'}</p>
        <div className="ds-state__actions">
          <button type="button" className="ds-button" onClick={onRetry} disabled={!canRetry}>Try again</button>
        </div>
      </div>
    )
  }
  if (run.status === 'stopped' && !run.compare) {
    return (
      <div className="ds-state ds-state--stopped">
        <span className="ds-state__mark" aria-hidden="true" />
        <p className="ds-state__title">Stopped before any panel answered</p>
        <p className="ds-state__body">Nothing was kept from this run. A request already sent may still have been billed.</p>
        <div className="ds-state__actions">
          <button type="button" className="ds-button" onClick={onRetry} disabled={!canRetry}>Compare again</button>
        </div>
      </div>
    )
  }
  if (run.status === 'voting' && run.blind) {
    return <BlindAnswers blind={run.blind} vote={run.vote} onVote={onVote} />
  }
  return <Revealed run={run} picks={picks} />
}

function Revealed({ run, picks }: { run: RunView; picks: Picks }) {
  const panels = run.compare?.panels ?? []
  const phase = phaseOf(run)
  const answered = panels.filter(p => p.ok).length
  const scaleMs = panels.length > 0 ? Math.max(0, ...panels.map(p => p.latencyMs ?? 0)) : null
  const summary = run.compare?.summary
  const judge = run.judge.state === 'done' && run.judge.verdict.bestOverall !== 'tie' ? run.judge.verdict.bestOverall : null
  const counted = run.vote.state === 'counted' ? run.vote : null
  const requested = (slot: Slot) => (slot === 'A' ? MODEL : picks[slot])
  const changes = new Map(counted?.changes.map(c => [c.model, c]) ?? [])
  const pickedPanel = counted && counted.choice !== 'tie' && counted.choice !== 'all-bad' ? panels.find(p => p.slot === counted.choice) : null
  return (
    <>
      {counted && (
        <div className="arena-reveal" role="status" tabIndex={-1} data-reveal-focus>
          <p className="arena-reveal__line">
            {counted.choice === 'tie'
              ? 'You called it a tie.'
              : counted.choice === 'all-bad'
                ? 'You marked every answer as bad.'
                : `You picked Panel ${counted.choice}, ${splitModel(pickedPanel?.requestedModel ?? '').name}.`}{' '}
            <a href="#board-title">See the leaderboard</a>
          </p>
          <ul className="arena-reveal__moves" aria-label="Rating changes from your vote">
            {counted.changes.map(c => (
              <li key={c.model}>
                <span className="ds-mono">{splitModel(c.model).name}</span>{' '}
                <span className={c.after >= c.before ? 'arena-delta arena-delta--up' : 'arena-delta arena-delta--down'}>
                  {formatDelta(c.after - c.before)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {run.vote.state === 'failed' && (
        <div className="ds-notice ds-notice--error" role="alert">{run.vote.message}</div>
      )}
      {run.notice && <div className="ds-notice ds-notice--warning">{run.notice}</div>}
      {phase === 'done' && panels.length > 0 && answered < SLOTS.length && (
        <div className="ds-state ds-state--partial">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">{answered} of {SLOTS.length} panels answered</p>
          <p className="ds-state__body">The panels that failed say why. Their figures stay in the trace.</p>
        </div>
      )}
      <div className="arena-grid">
        {SLOTS.map(slot => {
          const panel = panels.find(p => p.slot === slot) ?? null
          const change = panel ? (changes.get(panel.requestedModel) ?? null) : null
          return (
            <ResultCard
              key={slot}
              slot={slot}
              requested={requested(slot)}
              panel={panel}
              phase={phase}
              fastest={summary?.fastest?.slot === slot}
              cheapest={summary?.cheapest?.slot === slot}
              judgePick={judge === slot}
              scaleMs={scaleMs}
              yourPick={counted?.choice === slot}
              change={change}
              revealed={counted !== null}
            />
          )
        })}
      </div>
    </>
  )
}
