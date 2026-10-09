import { useState, type FormEvent } from 'react'
import { isValidPackageName, MAX_PACKAGES } from '../../netlify/shared/contract'
import { seriesColor } from '../lib/format'
import { PRESETS, WINDOWS } from '../lib/presets'

interface PackagePickerProps {
  names: string[]
  days: number
  onNamesChange: (names: string[]) => void
  onDaysChange: (days: number) => void
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((name, i) => name === b[i])

/** Why `input` cannot be added to `names`, or null when it can. */
function addProblem(input: string, names: string[]): string | null {
  if (input === '') return 'Type a package name first.'
  if (!isValidPackageName(input)) {
    return `"${input}" is not a valid npm name. Use lowercase letters, digits, dots, dashes or underscores, with an optional @scope/ prefix.`
  }
  if (names.includes(input)) return `${input} is already in the selection.`
  if (names.length >= MAX_PACKAGES) return `Compare up to ${MAX_PACKAGES} packages. Remove one first.`
  return null
}

/** The rail's main input: add a package, see the selection, pick the window. */
export default function PackagePicker({ names, days, onNamesChange, onDaysChange }: PackagePickerProps) {
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const add = (event: FormEvent) => {
    event.preventDefault()
    const name = draft.trim().toLowerCase()
    const found = addProblem(name, names)
    setProblem(found)
    if (found) return
    onNamesChange([...names, name])
    setDraft('')
  }

  return (
    <section className="ds-stack" aria-label="Packages">
      <form className="ds-field" onSubmit={add} noValidate>
        <label className="ds-label" htmlFor="package-input">
          Add a package
        </label>
        <div className="hub-add">
          <input
            id="package-input"
            className="ds-input ds-mono"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="zod or @tanstack/react-query"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={problem !== null}
            aria-describedby="package-help package-problem"
          />
          <button type="submit" className="ds-button">
            Add
          </button>
        </div>
        <p id="package-help" className="ds-help">
          Any package on npm, scoped names included. Up to {MAX_PACKAGES} at a time.
        </p>
        <p id="package-problem" className={problem ? 'ds-help ds-help--error' : 'ds-sr-only'} role="alert">
          {problem}
        </p>
      </form>

      <div className="ds-field" role="group" aria-labelledby="chosen-label">
        <p id="chosen-label" className="ds-label">
          Selected ({names.length} of {MAX_PACKAGES})
        </p>
        <ul className="hub-chips">
          {names.map((name, index) => (
            <li key={name} className="hub-chip">
              <span className="hub-swatch" style={{ background: seriesColor(index) }} aria-hidden="true" />
              <span className="ds-mono hub-chip__name">{name}</span>
              <button
                type="button"
                className="hub-chip__remove"
                aria-label={`Remove ${name}`}
                disabled={names.length === 1}
                onClick={() => onNamesChange(names.filter((n) => n !== name))}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="ds-field" role="group" aria-labelledby="window-label">
        <p id="window-label" className="ds-label">
          Time window
        </p>
        <div className="ds-seg hub-windows">
          {WINDOWS.map((option) => (
            <button key={option} type="button" aria-pressed={days === option} onClick={() => onDaysChange(option)}>
              {option} days
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

interface PresetsProps {
  names: string[]
  onPick: (names: string[]) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Ready-made comparisons. The page closes the list when a run starts on a narrow screen, so the result is not pushed down. */
export function Presets({ names, onPick, open, onOpenChange }: PresetsProps) {
  return (
    <details className="ds-disclosure" open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
      <summary>Ready-made comparisons</summary>
      <ul className="ds-choice-list">
        {PRESETS.map((preset) => (
          <li key={preset.label}>
            <button
              type="button"
              className={sameSet(names, preset.names) ? 'ds-choice ds-choice--selected' : 'ds-choice'}
              aria-pressed={sameSet(names, preset.names)}
              onClick={() => onPick(preset.names)}
            >
              <span className="ds-choice__label">{preset.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
