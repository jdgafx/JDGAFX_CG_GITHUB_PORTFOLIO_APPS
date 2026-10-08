import { COMPARE_MAX_TOKENS, PROMPT_MAX_CHARS } from '../../netlify/shared/contract'

const DEFAULT_TEMPERATURE = 0.7

interface PromptCardProps {
  prompt: string
  onPrompt: (value: string) => void
  system: string
  onSystem: (value: string) => void
  temperature: number | null
  onTemperature: (value: number | null) => void
  canRun: boolean
  running: boolean
  hasRun: boolean
  onRun: () => void
  onStop: () => void
  onClear: () => void
}

export function PromptCard(props: PromptCardProps) {
  const { prompt, onPrompt, system, onSystem, temperature, onTemperature } = props
  const { canRun, running, hasRun, onRun, onStop, onClear } = props
  const overLimit = prompt.length > PROMPT_MAX_CHARS

  return (
    <section className="ds-card" aria-labelledby="prompt-title">
      <div className="ds-card__head">
        <h2 className="ds-card__title" id="prompt-title">Prompt</h2>
        <span className={overLimit ? 'ds-hint arena-hint-over' : 'ds-hint'} id="prompt-count">
          {prompt.length.toLocaleString('en-US')} of {PROMPT_MAX_CHARS.toLocaleString('en-US')} characters
        </span>
      </div>
      <div className="ds-stack">
        <div className="ds-field">
          <label className="ds-label" htmlFor="prompt-input">Message sent to every panel</label>
          <textarea
            id="prompt-input"
            className="ds-textarea"
            value={prompt}
            onChange={e => onPrompt(e.target.value)}
            aria-describedby="prompt-count prompt-keys"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onRun()
              }
            }}
          />
        </div>

        <details className="arena-options">
          <summary>Options</summary>
          <div className="ds-stack">
            <div className="ds-field">
              <label className="ds-label" htmlFor="system-input">System prompt (optional)</label>
              <textarea
                id="system-input"
                className="ds-textarea"
                rows={3}
                value={system}
                onChange={e => onSystem(e.target.value)}
              />
            </div>
            <div className="ds-field">
              <label className="arena-check">
                <input
                  type="checkbox"
                  checked={temperature !== null}
                  onChange={e => onTemperature(e.target.checked ? DEFAULT_TEMPERATURE : null)}
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
                    aria-describedby="temperature-hint"
                  />
                </>
              )}
              <p className="ds-hint" id="temperature-hint">
                Off keeps the model's own setting. Each answer is capped at {COMPARE_MAX_TOKENS} output tokens.
              </p>
            </div>
          </div>
        </details>

        <div className="arena-actions">
          <button type="button" className="ds-button ds-button--primary" onClick={onRun} disabled={!canRun}>
            Compare models
          </button>
          {running && (
            <button type="button" className="ds-button" onClick={onStop}>
              Stop
            </button>
          )}
          <button type="button" className="ds-button" onClick={onClear} disabled={!hasRun || running}>
            Clear
          </button>
          <span className="ds-hint" id="prompt-keys">Ctrl+Enter also runs the comparison.</span>
        </div>
      </div>
    </section>
  )
}
