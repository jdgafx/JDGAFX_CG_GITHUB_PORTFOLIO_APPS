import { COMPARE_MAX_TOKENS, PROMPT_MAX_CHARS, SYSTEM_MAX_CHARS } from '../../netlify/shared/contract'
import type { Mode } from '../lib/run'

interface Sample {
  label: string
  prompt: string
}

// Each prompt has a rule that can be checked by counting or by arithmetic. Run against live models,
// the answers differ in whether they keep the rule, and the first one is in the box when the page opens.
export const SAMPLES: Sample[] = [
  {
    label: 'Word counts',
    prompt:
      'Write exactly three sentences about the ocean. The first must have exactly five words, the second exactly eight words, and the third exactly three words. Add nothing else.',
  },
  {
    label: 'Messy arithmetic',
    prompt:
      'I have 3 apples. I eat one, buy two dozen more, then give away a third of what I have. How many apples are left? Answer with just the number and one line of working.',
  },
  {
    label: 'Same first letter',
    prompt:
      'Name three countries whose capital city starts with the same letter as the country, and give the capitals. One line each, nothing else.',
  },
]

const DEFAULT_TEMPERATURE = 0.7

const MODES: { id: Mode; label: string; help: string }[] = [
  { id: 'blind', label: 'Blind', help: 'The models stay hidden until you vote. Your vote counts on the leaderboard.' },
  { id: 'open', label: 'Open', help: 'Names, times and costs show at once. Open runs take no vote.' },
]

interface PromptCardProps {
  prompt: string
  onPrompt: (value: string) => void
  system: string
  onSystem: (value: string) => void
  temperature: number | null
  onTemperature: (value: number | null) => void
  mode: Mode
  onMode: (mode: Mode) => void
  running: boolean
  onRun: () => void
}

function Count({ id, used, max }: { id: string; used: number; max: number }) {
  const over = used > max
  return (
    <span className={over ? 'ds-help--error ds-hint' : 'ds-hint'} id={id}>
      {over ? `${(used - max).toLocaleString('en-US')} over. ` : ''}
      {used.toLocaleString('en-US')} of {max.toLocaleString('en-US')} characters
    </span>
  )
}

export function PromptCard(props: PromptCardProps) {
  const { prompt, onPrompt, system, onSystem, temperature, onTemperature, mode, onMode, running, onRun } = props
  const maxTokens = COMPARE_MAX_TOKENS.toLocaleString('en-US')
  const modeHelp = MODES.find(m => m.id === mode)?.help

  return (
    <form
      id="prompt-form"
      className="ds-section"
      aria-labelledby="prompt-title"
      onSubmit={e => {
        e.preventDefault()
        onRun()
      }}
    >
      <div className="ds-section__head ds-section__head--bare">
        <h2 className="ds-section__title" id="prompt-title">Prompt</h2>
      </div>
      <div className="ds-stack">
        <div className="ds-field">
          <div className="arena-field-head">
            <label className="ds-label" htmlFor="prompt-input">Message sent to every panel</label>
            <Count id="prompt-count" used={prompt.length} max={PROMPT_MAX_CHARS} />
          </div>
          <textarea
            id="prompt-input"
            className="ds-textarea"
            value={prompt}
            onChange={e => onPrompt(e.target.value)}
            aria-describedby="prompt-count compare-help"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onRun()
              }
            }}
          />
        </div>

        <div className="ds-field">
          <span className="ds-label" id="mode-label">How to compare</span>
          <div className="ds-seg" role="group" aria-labelledby="mode-label" aria-describedby="mode-help">
            {MODES.map(m => (
              <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => onMode(m.id)} disabled={running}>
                {m.label}
              </button>
            ))}
          </div>
          <p className="ds-help" id="mode-help">{modeHelp}</p>
        </div>

        <details className="ds-disclosure">
          <summary>Sample prompts</summary>
          <ul className="ds-choice-list">
            {SAMPLES.map(sample => (
              <li key={sample.label}>
                <button
                  type="button"
                  className={sample.prompt === prompt ? 'ds-choice ds-choice--selected' : 'ds-choice'}
                  onClick={() => onPrompt(sample.prompt)}
                  disabled={running}
                  aria-pressed={sample.prompt === prompt}
                >
                  <span className="ds-choice__label">{sample.label}</span>
                  <span className="ds-choice__text">{sample.prompt}</span>
                  <span className="ds-choice__meta">Has a rule you can check by hand. Choosing it replaces the text above.</span>
                </button>
              </li>
            ))}
          </ul>
        </details>

        <details className="ds-disclosure">
          <summary>Options</summary>
          <div className="ds-stack arena-options">
            <div className="ds-field">
              <div className="arena-field-head">
                <label className="ds-label" htmlFor="system-input">System prompt (optional)</label>
                <Count id="system-count" used={system.length} max={SYSTEM_MAX_CHARS} />
              </div>
              <textarea
                id="system-input"
                className="ds-textarea"
                rows={3}
                value={system}
                onChange={e => onSystem(e.target.value)}
                aria-describedby="system-count system-help"
              />
              <p className="ds-help" id="system-help">Instructions sent to all three panels, such as a role or an output format.</p>
            </div>
            <div className="ds-field">
              <label className="arena-check">
                <input
                  type="checkbox"
                  checked={temperature !== null}
                  onChange={e => onTemperature(e.target.checked ? DEFAULT_TEMPERATURE : null)}
                  aria-describedby="temperature-help"
                />
                Set temperature
              </label>
              {temperature !== null && (
                <>
                  <label className="ds-label" htmlFor="temperature-input">Temperature: {temperature.toFixed(2)}</label>
                  <input
                    id="temperature-input"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={temperature}
                    onChange={e => onTemperature(Number(e.target.value))}
                    aria-describedby="temperature-help"
                  />
                </>
              )}
              <p className="ds-help" id="temperature-help">
                Off keeps each model's own setting. On sends one value to the panels that accept it; Panel A (Claude Haiku 5.5)
                ignores it. Each answer is capped at {maxTokens} output tokens.
              </p>
            </div>
          </div>
        </details>
      </div>
    </form>
  )
}
