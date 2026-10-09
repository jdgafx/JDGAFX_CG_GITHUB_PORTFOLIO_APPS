import { COMPARE_MAX_TOKENS, PROMPT_MAX_CHARS } from '../../netlify/shared/contract'

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

interface PromptCardProps {
  prompt: string
  onPrompt: (value: string) => void
  onSample: (prompt: string) => void
  system: string
  onSystem: (value: string) => void
  temperature: number | null
  onTemperature: (value: number | null) => void
  running: boolean
  onRun: () => void
}

export function PromptCard(props: PromptCardProps) {
  const { prompt, onPrompt, onSample, system, onSystem, temperature, onTemperature, running, onRun } = props
  const overLimit = prompt.length > PROMPT_MAX_CHARS
  const maxTokens = COMPARE_MAX_TOKENS.toLocaleString('en-US')

  return (
    <section className="ds-section" aria-labelledby="prompt-title">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="prompt-title">Prompt</h2>
        <p className="ds-section__sub">The question all three panels answer.</p>
      </div>
      <div className="ds-stack">
        <div className="ds-field">
          <div className="arena-field-head">
            <label className="ds-label" htmlFor="prompt-input">Message sent to every panel</label>
            <span className={overLimit ? 'ds-hint arena-hint-over' : 'ds-hint'} id="prompt-count">
              {prompt.length.toLocaleString('en-US')} of {PROMPT_MAX_CHARS.toLocaleString('en-US')} characters
            </span>
          </div>
          <textarea
            id="prompt-input"
            className="ds-textarea"
            value={prompt}
            onChange={e => onPrompt(e.target.value)}
            aria-describedby="prompt-help prompt-count compare-help"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onRun()
              }
            }}
          />
          <p className="ds-help" id="prompt-help">
            Your question. The same prompt goes to all three panels, so the answers can be compared directly.
          </p>
        </div>

        <div className="ds-field">
          <span className="ds-label" id="sample-label">Sample prompts</span>
          <div className="arena-sample" role="group" aria-labelledby="sample-label" aria-describedby="sample-help">
            {SAMPLES.map(sample => (
              <button
                key={sample.label}
                type="button"
                className="ds-button"
                onClick={() => onSample(sample.prompt)}
                disabled={running}
              >
                {sample.label}
              </button>
            ))}
          </div>
          <p className="ds-help" id="sample-help">
            Each has a rule you can check by hand, so you can see which model keeps it. Choosing one replaces the text above.
          </p>
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
                aria-describedby="system-help"
              />
              <p className="ds-help" id="system-help">
                Instructions sent to all three panels, such as a role or an output format. Leave it empty to send only
                the prompt.
              </p>
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
                Off keeps each model's own setting. On sends one value to all three panels. Panel A (Claude Haiku 5.5) ignores
                temperature, so the value applies to panels B and C only when their models accept it. Each answer is capped at{' '}
                {maxTokens} output tokens.
              </p>
            </div>
          </div>
        </details>
      </div>
    </section>
  )
}
