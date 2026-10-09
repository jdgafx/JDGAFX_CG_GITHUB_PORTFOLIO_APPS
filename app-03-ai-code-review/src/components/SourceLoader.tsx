import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Parsed } from '../lib/github'

export interface Suggestion {
  link: string
  title: string
  meta: string
  blurb: string
}

interface SourceLoaderProps<Ref, Loaded> {
  /** Prefix for element ids, so the file and pull request loaders never share one. */
  id: string
  label: string
  placeholder: string
  help: string
  action: string
  examplesLabel: string
  parse: (text: string) => Parsed<Ref>
  load: (ref: Ref, signal: AbortSignal) => Promise<Parsed<Loaded>>
  /** Called with what was loaded. Returns a note to show under the form, or null. */
  onLoaded: (value: Loaded) => string | null
  suggestions: readonly Suggestion[]
  /** True while a review runs: loading would swap the source under it. */
  disabled: boolean
  /** An error belongs to the source it was shown over, and goes when this changes. */
  scope: unknown
  /** Fields that belong with the input, such as the language. */
  fields?: ReactNode
  /** The action dock. It sits right after the input, so Review is never pushed below the examples. */
  children: ReactNode
  /** What is loaded now, shown under the examples. */
  loaded?: ReactNode
  /** Changes when a run starts on a narrow screen: the examples fold away so the result is not pushed down. */
  collapseKey: number
}

/** A link field, an action dock, a list of real examples and the facts of what is loaded. Used for files and pull requests. */
export function SourceLoader<Ref, Loaded>(props: SourceLoaderProps<Ref, Loaded>) {
  const { id, label, placeholder, help, action, examplesLabel, parse, load, onLoaded, suggestions, disabled, scope, fields, children, loaded, collapseKey } = props
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ message: string; scope: unknown } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // Open beside the run on a wide screen, closed on a phone where it would push the run down.
  const [examplesOpen, setExamplesOpen] = useState(() => window.matchMedia('(min-width: 1000px)').matches)
  const [seenKey, setSeenKey] = useState(collapseKey)
  if (seenKey !== collapseKey) {
    setSeenKey(collapseKey)
    setExamplesOpen(false)
  }
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async (text: string) => {
    const parsed = parse(text)
    if (!parsed.ok) {
      setFailure({ message: parsed.error, scope })
      setNote(null)
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setFailure(null)
    setNote(null)
    try {
      // Only an abort rejects: a newer load or leaving the page. That one has nothing to show.
      const result = await load(parsed.value, controller.signal).catch(() => null)
      if (result === null) return
      if (!result.ok) {
        setFailure({ message: result.error, scope })
        return
      }
      setNote(onLoaded(result.value))
      if (!window.matchMedia('(min-width: 1000px)').matches) setExamplesOpen(false)
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setBusy(false)
      }
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(input)
  }

  const error = failure !== null && failure.scope === scope ? failure.message : null
  const locked = disabled || busy

  return (
    <>
      <section className="ds-section" aria-label={label}>
        <form className="ds-field" onSubmit={submit}>
          <label className="ds-label" htmlFor={`${id}-input`}>
            {label}
          </label>
          <div className="loader__row">
            <input
              id={`${id}-input`}
              className="ds-input ds-mono"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={placeholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-describedby={`${id}-help`}
              aria-invalid={error !== null}
            />
            <button type="submit" className="ds-button" disabled={locked || !input.trim()} aria-busy={busy}>
              {busy ? 'Loading…' : action}
            </button>
          </div>
          <p id={`${id}-help`} className="ds-help">
            {help}
          </p>
        </form>
        {error && (
          <p role="alert" className="ds-notice ds-notice--error">
            {error}
          </p>
        )}
        {note && (
          <p className="ds-help" role="status">
            {note}
          </p>
        )}
        {fields}
      </section>

      {children}

      <details className="ds-disclosure" open={examplesOpen} onToggle={(e) => setExamplesOpen(e.currentTarget.open)}>
        <summary>{examplesLabel}</summary>
        <ul className="ds-choice-list">
          {suggestions.map((s) => (
            <li key={s.link}>
              <button
                type="button"
                className={input === s.link ? 'ds-choice ds-choice--selected' : 'ds-choice'}
                disabled={locked}
                onClick={() => {
                  setInput(s.link)
                  void run(s.link)
                }}
              >
                <span className="ds-choice__label ds-mono">{s.title}</span>
                <span className="ds-choice__text">{s.blurb}</span>
                <span className="ds-choice__meta">{s.meta}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
      {loaded}
    </>
  )
}
