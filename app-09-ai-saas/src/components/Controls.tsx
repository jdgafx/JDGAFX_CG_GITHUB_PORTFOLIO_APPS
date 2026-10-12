import { useState, type FormEvent } from 'react'
import type { WindowDays } from '../../shared/types'

export interface Preset {
  label: string
  names: string[]
}

/** Ready-made comparisons: plain lists of npm names, no different from picking the packages by hand. */
export const PRESETS: Preset[] = [
  { label: 'Vite vs webpack vs esbuild', names: ['vite', 'webpack', 'esbuild'] },
  { label: 'Prisma vs Drizzle vs TypeORM', names: ['prisma', 'drizzle-orm', 'typeorm'] },
]

const WINDOWS: WindowDays[] = [30, 90, 365]

interface ControlsProps {
  names: string[]
  days: WindowDays
  /** A run is live. */
  busy: boolean
  /** Downloads and releases have both settled and no run is live. */
  canRun: boolean
  /** Returns a plain-language refusal, or null when the name was added. */
  onAdd: (raw: string) => string | null
  onRemove: (name: string) => void
  onPreset: (names: string[]) => void
  onDays: (days: WindowDays) => void
  onExplain: () => void
}

export default function Controls({ names, days, busy, canRun, onAdd, onRemove, onPreset, onDays, onExplain }: ControlsProps) {
  const [draft, setDraft] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)

  const add = (event: FormEvent) => {
    event.preventDefault()
    if (draft.trim() === '') return
    const refused = onAdd(draft)
    setRefusal(refused)
    if (refused === null) setDraft('')
  }

  return (
    <div className="ds-controls">
      <form className="ds-field" onSubmit={add}>
        <label className="ds-label" htmlFor="pkg-name">
          Package name
        </label>
        <div className="ds-row">
          <input
            id="pkg-name"
            className="ds-input add-input"
            type="text"
            value={draft}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby={refusal ? 'pkg-refusal' : undefined}
            onChange={event => setDraft(event.target.value)}
          />
          <button type="button" className="ds-button" onClick={add}>
            Add
          </button>
        </div>
        {refusal && (
          <p id="pkg-refusal" className="ds-help ds-help--error" role="alert">
            {refusal}
          </p>
        )}
        <div className="ds-chips" aria-label="Selected packages">
          {names.map(name => (
            <span key={name} className="ds-chip">
              {name}
              <button type="button" className="chip-remove" aria-label={`Remove ${name}`} onClick={() => onRemove(name)} disabled={busy}>
                ×
              </button>
            </span>
          ))}
        </div>
      </form>

      <details className="ds-disclosure">
        <summary>Ready-made comparisons</summary>
        <ul className="ds-choice-list">
          {PRESETS.map(preset => (
            <li key={preset.label}>
              <button type="button" className="ds-choice" disabled={busy} onClick={() => onPreset([...preset.names])}>
                <span className="ds-choice__label">{preset.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>

      <div className="ds-field">
        <span className="ds-label" id="window-label">
          Window
        </span>
        <div className="ds-seg" role="group" aria-labelledby="window-label">
          {WINDOWS.map(d => (
            <button key={d} type="button" aria-pressed={d === days} disabled={busy} onClick={() => onDays(d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>

      <div className="ds-actions">
        <button type="button" className="ds-button ds-button--primary" disabled={!canRun || busy} aria-busy={busy} onClick={onExplain}>
          Explain spikes
        </button>
      </div>
    </div>
  )
}
