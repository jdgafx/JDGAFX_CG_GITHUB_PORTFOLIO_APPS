import { useState } from 'react'

// Examples that fill the box. `source` names the live data the question draws on.
const EXAMPLES = [
  { question: "What's the weather in Lisbon right now?", source: 'Live weather from Open-Meteo' },
  { question: 'Who was Ada Lovelace?', source: 'Wikipedia summary' },
  { question: 'Is it warmer in Tokyo or in Oslo today?', source: 'Two live weather lookups' },
  { question: 'How does a voice assistant turn speech into an answer?', source: 'No tools, the model alone' },
] as const

interface ExamplesProps {
  onPick: (question: string) => void
  disabled: boolean
  /** Changes when a run starts on a narrow screen, so the list closes and the answer is not pushed down. */
  collapseKey: number
}

export default function Examples({ onPick, disabled, collapseKey }: ExamplesProps) {
  const [open, setOpen] = useState(false)
  // A new key (a run started on a narrow screen) closes the list; adjusting state while rendering avoids an extra pass.
  const [seenKey, setSeenKey] = useState(collapseKey)
  if (seenKey !== collapseKey) {
    setSeenKey(collapseKey)
    setOpen(false)
  }

  // An example fills the box and takes focus. It never sends on its own.
  const pick = (question: string) => {
    onPick(question)
    document.getElementById('vox-text')?.focus()
  }

  return (
    <details className="ds-disclosure" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>Try an example</summary>
        <ul className="ds-choice-list vox-examples">
          {EXAMPLES.map(({ question, source }) => (
            <li key={question}>
              <button type="button" className="ds-choice" onClick={() => pick(question)} disabled={disabled}>
                <span className="ds-choice__label">{question}</span>
                <span className="ds-choice__text">{source}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="ds-help">Each example fills the box. Press Ask when you are ready.</p>
      </details>
  )
}
