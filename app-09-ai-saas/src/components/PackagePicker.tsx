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

/** The controls column: which packages to compare, and over how many days. */
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
    <section className="ds-section hub-picker" aria-labelledby="picker-title">
      <div className="ds-section__head">
        <h2 id="picker-title" className="ds-section__title">
          Packages
        </h2>
        <p className="ds-section__sub">Choose what to compare. Daily downloads load live from the npm registry.</p>
      </div>

      <div className="ds-stack">
        <div className="hub-group" role="group" aria-labelledby="presets-label">
          <p id="presets-label" className="ds-label">
            Ready-made comparisons
          </p>
          <div className="hub-presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="ds-button hub-preset"
                aria-pressed={sameSet(names, preset.names)}
                onClick={() => {
                  setProblem(null)
                  onNamesChange(preset.names)
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="ds-help">One click replaces the selection with a set of well-known packages.</p>
        </div>

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
          <p id="package-problem" className="hub-problem" role="alert">
            {problem}
          </p>
        </form>

        <div className="hub-group" role="group" aria-labelledby="chosen-label">
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
          <p className="ds-help">Each package keeps its colour in every chart. At least one stays selected.</p>
        </div>

        <div className="hub-group" role="group" aria-labelledby="window-label">
          <p id="window-label" className="ds-label">
            Time window
          </p>
          <div className="hub-windows">
            {WINDOWS.map((option) => (
              <button
                key={option}
                type="button"
                className="ds-button"
                aria-pressed={days === option}
                onClick={() => onDaysChange(option)}
              >
                {option} days
              </button>
            ))}
          </div>
          <p className="ds-help">How far back to look. The window ends on the latest day npm has published.</p>
        </div>
      </div>
    </section>
  )
}
