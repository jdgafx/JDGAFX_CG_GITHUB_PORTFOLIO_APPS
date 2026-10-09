import { MAX_QUESTION_CHARS, type AnalysisMode } from '../lib/api'
import { MODES, SCOPES, scopeOf, type Scope } from '../lib/modes'
import type { Box } from '../lib/region'
import { WHOLE_MODES } from '../lib/useAnalysis'

interface AskPanelProps {
  mode: AnalysisMode
  /** The whole-image mode to return to when the visitor goes back to "Whole image". */
  lastWhole: AnalysisMode
  question: string
  questionError: string
  running: boolean
  box: Box | null
  regionCount: number
  onModeChange: (mode: AnalysisMode) => void
  onQuestionChange: (value: string) => void
  onRun: () => void
  /** On a phone in Region mode: the picture, placed above the question so drawing, typing and asking follow each other. */
  children?: React.ReactNode
}

const QUESTION_PLACEHOLDER: Record<string, string> = {
  qa: 'For example: what does the sign say?',
  region: 'For example: what does the text in this box say?',
  compare: 'Optional. For example: which photo shows the street more clearly?',
}

export default function AskPanel({
  mode,
  lastWhole,
  question,
  questionError,
  running,
  box,
  regionCount,
  onModeChange,
  onQuestionChange,
  onRun,
  children,
}: AskPanelProps) {
  const scope = scopeOf(mode)
  const askable = mode === 'qa' || mode === 'region' || mode === 'compare'
  const pickScope = (next: Scope) => {
    if (next === 'whole') onModeChange(lastWhole)
    else onModeChange(next)
  }
  const label = mode === 'compare' ? 'Question for the verdict (optional)' : 'Your question'

  return (
    <section className="ds-section" aria-labelledby="mode-title">
      <h2 id="mode-title" className="ds-label vl-label">
        Ask about
      </h2>
      <div className="ds-seg vl-scope" role="group" aria-label="What to ask about">
        {SCOPES.map(option => (
          <button
            key={option.id}
            type="button"
            aria-pressed={scope === option.id}
            disabled={running}
            onClick={() => pickScope(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {scope !== 'region' && <p className="ds-help">{SCOPES.find(option => option.id === scope)?.hint}</p>}

      {scope === 'whole' && (
        <div className="mode-list" role="radiogroup" aria-label="Mode">
          {MODES.filter(option => WHOLE_MODES.includes(option.id)).map(option => {
            const selected = option.id === mode
            return (
              <label key={option.id} className={selected ? 'mode-option is-selected' : 'mode-option'}>
                <input
                  type="radio"
                  name="mode"
                  value={option.id}
                  checked={selected}
                  disabled={running}
                  onChange={() => onModeChange(option.id)}
                />
                <span className="mode-option__body">
                  <span className="mode-option__label">{option.label}</span>
                  <span className="ds-help">{option.hint}</span>
                </span>
              </label>
            )
          })}
        </div>
      )}

      {scope === 'region' && (
        <p className="ds-help" id="box-state" role="status">
          {box
            ? 'Box drawn. Type a question about it, then ask. Draw again to change the box.'
            : regionCount > 0
              ? 'Draw another box on the picture to ask about a different part.'
              : 'Drag on the picture to draw a box. With a keyboard, tab to the picture and press Enter.'}
        </p>
      )}

      {scope === 'region' && children}

      {askable && (
        <div className="ds-field">
          <label className="ds-label" htmlFor="question">
            {label}
          </label>
          <textarea
            id="question"
            className="ds-textarea vl-question"
            rows={3}
            maxLength={MAX_QUESTION_CHARS}
            value={question}
            disabled={running}
            placeholder={QUESTION_PLACEHOLDER[mode]}
            aria-invalid={questionError ? true : undefined}
            aria-describedby={questionError ? 'question-count question-error' : 'question-count'}
            onChange={event => onQuestionChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                onRun()
              }
            }}
          />
          <p id="question-count" className="ds-help">
            <span className="ds-mono">
              {question.length} / {MAX_QUESTION_CHARS}
            </span>{' '}
            characters. Enter asks, Shift+Enter adds a line.
          </p>
          {questionError && (
            <p id="question-error" className="ds-notice ds-notice--error" role="alert">
              {questionError}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
