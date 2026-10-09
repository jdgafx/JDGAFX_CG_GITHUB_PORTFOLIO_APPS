import { useState } from 'react'
import { describePlan, headlineFor } from '../lib/answer'
import { followUpIdeas } from '../lib/followUps'
import { MAX_QUESTION_CHARS } from '../lib/limits'
import Prose from './Prose'
import { plainText } from '../lib/prose'
import type { AnalysisThreadState } from '../hooks/useAnalysisThread'
import type { ParsedData, PlanChange, ThreadStep } from '../types'

const PLAN_PARTS = [
  ['Group by', 'groupBy'],
  ['Measure', 'measure'],
  ['Filter rows', 'filter'],
  ['Keep groups where', 'having'],
  ['Keep', 'limit'],
  ['Sort', 'sort'],
] as const

const CHIP: Record<PlanChange['effect'], string> = {
  added: 'ds-chip ds-chip--add app-change',
  changed: 'ds-chip ds-chip--change app-change',
  removed: 'ds-chip ds-chip--remove app-change',
  same: 'ds-chip ds-chip--muted app-change',
}

function Chips({ changes }: { changes: PlanChange[] }) {
  if (changes.length === 0) return null
  return (
    <ul className="app-changes" aria-label="What this follow-up changed in the plan">
      {changes.map((change) => (
        <li key={change.text} className={CHIP[change.effect]}>
          {change.text}
        </li>
      ))}
    </ul>
  )
}

function ActiveBody({ step }: { step: ThreadStep }) {
  const { result } = step
  const plan = result.queryPlan
  const headline = headlineFor(result)
  const words = describePlan(plan, result.vocab)
  return (
    <div className="app-step__body">
      {step.notApplied && (
        <div className="ds-state ds-state--partial" role="status">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">This follow-up was not applied</p>
          <p className="ds-state__body"><Prose text={step.notApplied} /> The chart below is still the previous answer.</p>
        </div>
      )}
      {headline.notice && (
        <p className="app-notice" role="note">
          <strong>Not in this data.</strong> <Prose text={headline.notice} />
        </p>
      )}
      {headline.answer && (
        <div className="ds-lead__text app-answer ds-num">
          <p>{headline.answer}</p>
        </div>
      )}
      {headline.note && <p className="ds-help"><Prose text={headline.note} /></p>}
      <details className="app-details">
        <summary>How this was computed</summary>
        <dl className="ds-kv app-plan-words">
          {PLAN_PARTS.filter(([, part]) => words[part] !== undefined && words[part] !== null).map(([label, part]) => (
            <div key={label} className="app-plan-words__row">
              <dt>{label}</dt>
              <dd>{words[part]}</dd>
            </div>
          ))}
        </dl>
        {plan.explanation && <p className="ds-help"><Prose text={plan.explanation} /></p>}
        <div className="ds-code-wrap">
          <pre className="ds-code app-plan" tabIndex={0} role="region" aria-label="Query plan as JSON, scrolls sideways">
            {JSON.stringify(
              {
                chartType: plan.chartType,
                groupBy: plan.groupBy,
                aggregate: plan.aggregate,
                ...(plan.filter ? { filter: plan.filter } : {}),
                ...(plan.moreFilters ? { moreFilters: plan.moreFilters } : {}),
                ...(plan.having ? { having: plan.having } : {}),
                ...(plan.sortBy ? { sortBy: plan.sortBy } : {}),
                ...(plan.limit !== undefined ? { limit: plan.limit } : {}),
              },
              null,
              2,
            )}
          </pre>
        </div>
      </details>
    </div>
  )
}

interface StepRowProps {
  step: ThreadStep
  index: number
  active: boolean
  disabled: boolean
  refines: number | null
  onOpen: (id: string) => void
}

function StepRow({ step, index, active, disabled, refines, onOpen }: StepRowProps) {
  const headline = headlineFor(step.result)
  const summary = step.notApplied ? `Not applied: ${plainText(step.notApplied)}` : (headline.answer ?? step.result.queryPlan.title)
  return (
    <li className={active ? 'app-step app-step--active' : 'app-step'} aria-current={active ? 'step' : undefined}>
      <button
        type="button"
        className="app-step__head"
        {...(active ? { 'data-result-focus': '' } : {})}
        disabled={disabled}
        aria-expanded={active}
        aria-label={`Step ${index}: ${step.question}${active ? ', open' : ', open this step'}`}
        onClick={() => onOpen(step.id)}
      >
        <span className="ds-trace__index" aria-hidden="true">{index}</span>
        <span className="app-step__question">{step.question}</span>
        <span className={step.notApplied ? 'ds-badge ds-badge--warning' : 'ds-badge'}>
          {step.notApplied ? 'Not applied' : step.kind === 'ask' ? 'Question' : 'Follow-up'}
        </span>
      </button>
      {refines !== null && <p className="ds-help app-step__from">Refines step {refines}</p>}
      <Chips changes={step.changes} />
      {active ? <ActiveBody step={step} /> : <p className="app-step__summary ds-num">{summary}</p>}
    </li>
  )
}

interface ComposerProps {
  active: ThreadStep
  data: ParsedData
  busy: boolean
  onAsk: (question: string) => void
}

function FollowUpComposer({ active, data, busy, onAsk }: ComposerProps) {
  const [text, setText] = useState('')
  const length = Array.from(text.trim()).length
  const valid = length >= 1 && length <= MAX_QUESTION_CHARS
  const ideas = followUpIdeas(active.result, data.headers)
  const send = (question: string) => {
    if (!busy && question.trim()) {
      onAsk(question)
      setText('')
    }
  }
  return (
    <form
      className="app-composer"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) send(text)
      }}
    >
      <label className="ds-label" htmlFor="follow-up">Ask a follow-up</label>
      <p id="follow-up-help" className="ds-help">
        The model gets the plan on screen and your words, and returns a new plan. {length > 0 && `${length} of ${MAX_QUESTION_CHARS} characters.`}
      </p>
      <div className="app-composer__row">
        <input
          id="follow-up"
          className="ds-input"
          type="text"
          value={text}
          disabled={busy}
          autoComplete="off"
          placeholder="Only Alaska, now by month, show the top 5"
          aria-describedby="follow-up-help"
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="ds-button ds-button--primary" disabled={!valid || busy}>
          Refine plan
        </button>
      </div>
      <div className="ds-row" role="group" aria-label="Follow-up ideas">
        {ideas.map((idea) => (
          <button key={idea} type="button" className="ds-button app-idea" disabled={busy} onClick={() => send(idea)}>
            {idea}
          </button>
        ))}
      </div>
    </form>
  )
}

interface ThreadPanelProps {
  state: AnalysisThreadState
  data: ParsedData | null
  datasetLabel: string
  onAskFollowUp: (question: string) => void
}

/** The analysis thread: each question, what it changed in the plan, its answer, and the way to ask the next one. */
export default function ThreadPanel({ state, data, datasetLabel, onAskFollowUp }: ThreadPanelProps) {
  const { thread, step, pending, canFollowUp } = state
  if (!thread) return null
  const busy = pending !== null
  const position = new Map<string, number>(thread.steps.map((item, index) => [item.id, index + 1]))

  return (
    <section className="ds-lead app-thread" aria-labelledby="thread-title">
      <div className="ds-section__head ds-section__head--bare ds-section__head--row">
        <h2 id="thread-title" className="ds-section__title">Analysis thread</h2>
        <span className="ds-hint ds-num">
          {thread.steps.length} {thread.steps.length === 1 ? 'step' : 'steps'}. Choose a step to open it again.
        </span>
      </div>
      <ol className="app-steps">
        {thread.steps.map((item, index) => {
          const parent = item.basedOn ? (position.get(item.basedOn) ?? null) : null
          const refines = parent !== null && parent !== index ? parent : null
          return (
            <StepRow
              key={item.id}
              step={item}
              index={index + 1}
              active={item.id === step?.id}
              disabled={busy}
              refines={refines}
              onOpen={state.openStep}
            />
          )
        })}
        {pending && (
          <li className="app-step app-step--pending" aria-busy="true">
            <div className="app-step__head app-step__head--static">
              <span className="ds-trace__index" aria-hidden="true">{thread.steps.length + 1}</span>
              <span className="app-step__question">{pending.question}</span>
              <span className="ds-badge ds-badge--accent">
                <span className="ds-dot ds-dot--running" aria-hidden="true" />
                {pending.mode === 'follow-up' ? 'Refining the plan' : 'Planning'}
              </span>
            </div>
            <div className="ds-skeleton"><span /><span /><span /></div>
            <div className="ds-state__actions">
              <button type="button" className="ds-button" onClick={state.stop}>Stop</button>
            </div>
          </li>
        )}
      </ol>
      {canFollowUp && step && data && <FollowUpComposer active={step} data={data} busy={busy} onAsk={onAskFollowUp} />}
      {!canFollowUp && (
        <p className="ds-help">
          This thread was run on {thread.dataset}. Load that dataset again to ask a follow-up; the loaded data is {datasetLabel}.
        </p>
      )}
    </section>
  )
}
