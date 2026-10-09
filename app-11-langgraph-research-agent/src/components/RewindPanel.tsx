import { useState } from 'react'
import { EDIT_LIMITS, type CheckpointOffer } from '../../netlify/shared/events'
import { charCount } from '../lib/fork'
import { count } from '../lib/format'

export type Edit = { queries: string[] } | { notes: string }

export const offerKey = (offer: Pick<CheckpointOffer, 'kind' | 'visit'>) => `${offer.kind}-${offer.visit}`
const labelOf = (offer: CheckpointOffer) => (offer.kind === 'plan' ? 'Plan' : `Critic, visit ${offer.visit}`)

interface RewindPanelProps {
  offers: CheckpointOffer[]
  selected: string | null
  busy: boolean
  onSelect: (key: string) => void
  onRun: (offer: CheckpointOffer, edit: Edit) => void
}

function QueryEditor({ offer, queries, setQueries }: { offer: CheckpointOffer; queries: string[]; setQueries: (next: string[]) => void }) {
  return (
    <div className="ds-stack">
      <p className="ds-help">
        The plan chose these searches. Change them and the agent searches with yours, though it may still read a page your question names. Every step after the plan runs again.
      </p>
      {queries.map((query, i) => {
        const id = `rewind-query-${offer.visit}-${i}`
        const length = charCount(query)
        return (
          <div className="ds-field" key={id}>
            <label className="ds-label" htmlFor={id}>{`Search query ${i + 1}`}</label>
            <input
              id={id}
              className="ds-input"
              type="text"
              value={query}
              aria-describedby={`${id}-count`}
              onChange={(event) => setQueries(queries.map((q, k) => (k === i ? event.target.value : q)))}
            />
            <p id={`${id}-count`} className={length > EDIT_LIMITS.queryChars ? 'ds-help ds-help--error' : 'ds-help'}>
              {count(length)} of {EDIT_LIMITS.queryChars} characters
              {length > EDIT_LIMITS.queryChars && `. Too long by ${length - EDIT_LIMITS.queryChars}.`}
            </p>
          </div>
        )
      })}
      {queries.length < EDIT_LIMITS.maxQueries && (
        <div className="rewind__actions">
          <button type="button" className="ds-button" onClick={() => setQueries([...queries, ''])}>
            Add a query
          </button>
        </div>
      )}
    </div>
  )
}

function NoteEditor({ offer, notes, setNotes }: { offer: CheckpointOffer; notes: string; setNotes: (next: string) => void }) {
  const id = `rewind-notes-${offer.visit}`
  const length = charCount(notes)
  return (
    <div className="ds-stack">
      <p className="ds-help">
        The critic was about to read this draft. Write what it should ask for instead; the draft is rewritten with your
        note, then reviewed again.
      </p>
      <blockquote className="rewind__draft" aria-label="Draft the critic was about to read">
        {offer.draft}
      </blockquote>
      {offer.sources.length > 0 && (
        <p className="ds-help">{`Pages read: ${offer.sources.join('; ')}. The rewrite can use only these.`}</p>
      )}
      <div className="ds-field">
        <label className="ds-label" htmlFor={id}>What should the critic ask for?</label>
        <textarea
          id={id}
          className="ds-textarea"
          rows={3}
          value={notes}
          placeholder="For example: state the theme, not only the year"
          aria-describedby={`${id}-count`}
          onChange={(event) => setNotes(event.target.value)}
        />
        <p id={`${id}-count`} className={length > EDIT_LIMITS.notesChars ? 'ds-help ds-help--error' : 'ds-help'}>
          {count(length)} of {EDIT_LIMITS.notesChars} characters
          {length > EDIT_LIMITS.notesChars && `. Too long by ${length - EDIT_LIMITS.notesChars}.`}
        </p>
      </div>
    </div>
  )
}

/** Pick a saved step of the finished run, change the one field that matters there, and run on from it. */
export function RewindPanel({ offers, selected, busy, onSelect, onRun }: RewindPanelProps) {
  const [queries, setQueries] = useState<Record<string, string[]>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const offer = offers.find((item) => offerKey(item) === selected) ?? null
  if (offers.length === 0) return null

  let edit: Edit | null = null
  let ready = false
  if (offer) {
    const key = offerKey(offer)
    if (offer.kind === 'plan') {
      const current = (queries[key] ?? offer.queries ?? []).map((q) => q.trim()).filter((q) => q !== '')
      edit = { queries: current }
      ready = current.length >= 1 && current.length <= EDIT_LIMITS.maxQueries && current.every((q) => charCount(q) <= EDIT_LIMITS.queryChars)
    } else {
      const current = notes[key] ?? ''
      edit = { notes: current }
      ready = charCount(current) >= 1 && charCount(current) <= EDIT_LIMITS.notesChars
    }
  }

  return (
    <section className="ds-section ds-panel rewind" aria-labelledby="rewind-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="rewind-title" className="ds-section__title">Rewind and edit</h2>
        <p className="ds-section__sub">
          LangGraph saved the state at each step. Pick one, change what it decided, and only the steps after it run
          again, on live pages with the real model.
        </p>
      </div>
      <ul className="ds-choice-list" aria-label="Saved steps">
        {offers.map((item) => {
          const key = offerKey(item)
          return (
            <li key={key}>
              <button
                type="button"
                className={key === selected ? 'ds-choice ds-choice--selected' : 'ds-choice'}
                aria-pressed={key === selected}
                disabled={busy}
                onClick={() => onSelect(key)}
              >
                <span className="ds-choice__label">{labelOf(item)}</span>
                <span className="ds-choice__text">{item.kind === 'plan' ? `Searches: ${(item.queries ?? []).join('; ')}` : `Draft: ${item.draft ?? ''}`}</span>
                <span className="ds-choice__meta">
                  {item.kind === 'plan'
                    ? 'Edit the search queries. Every step after the plan runs again.'
                    : 'Replace the critic\'s review with your note. The draft, the next review and the final step run again.'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {offer && edit && (
        <div className="ds-stack rewind__body">
          {offer.kind === 'plan' ? (
            <QueryEditor
              offer={offer}
              queries={queries[offerKey(offer)] ?? offer.queries ?? []}
              setQueries={(next) => setQueries({ ...queries, [offerKey(offer)]: next })}
            />
          ) : (
            <NoteEditor offer={offer} notes={notes[offerKey(offer)] ?? ''} setNotes={(next) => setNotes({ ...notes, [offerKey(offer)]: next })} />
          )}
          <div className="rewind__actions">
            <button type="button" className="ds-button ds-button--primary" disabled={!ready || busy} onClick={() => onRun(offer, edit)}>
              {offer.kind === 'plan' ? 'Re-run from the plan' : 'Re-run from the critic'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
