import { useState } from 'react'
import { STAGE_LABELS, wordCount, type StageId, type StageOutputs } from '../../netlify/shared/contract'
import { bodyOf, listedSources, parseSourcePack, type Source } from '../../netlify/shared/sourcepack'
import { CHANGE_STAGES, compareStage, readabilityTrend, type ChangeStage } from '../lib/compare'
import type { ChangeNote } from '../../netlify/shared/changes'
import type { PipelineOutcome } from '../lib/api'
import DiffView from './DiffView'
import Inline from './Inline'
import Prose from './Prose'
import Readability from './Readability'
import Seg from './Seg'

type View = 'final' | 'changes'

// The best version written so far: Polish, else Edit, else Draft.
function bestStage(outputs: StageOutputs): 'polish' | 'edit' | 'draft' | null {
  if (outputs.polish !== undefined) return 'polish'
  if (outputs.edit !== undefined) return 'edit'
  if (outputs.draft !== undefined) return 'draft'
  return null
}

const FROM_LABEL: Record<ChangeStage, string> = { edit: 'Draft → Edit', polish: 'Edit → Polish' }

function plural(count: number, word: string): string {
  return `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`
}

function shownUrl(url: string): string {
  try {
    const { host, pathname } = new URL(url)
    return decodeURIComponent(`${host.replace(/^www\./, '')}${pathname === '/' ? '' : pathname}`)
  } catch {
    return url
  }
}

function Cites({ sources, label }: { sources: Source[]; label: string }) {
  return (
    <ol className="ds-cite" aria-label={label}>
      {sources.map(source => (
        <li key={source.n}>
          <span className="ds-cite__n">{`[${source.n}]`}</span>
          <a className="ds-cite__title" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
          <span className="ds-cite__url">{shownUrl(source.url)}</span>
        </li>
      ))}
    </ol>
  )
}

interface StateProps {
  tone: 'empty' | 'loading' | 'error' | 'stopped'
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}

function PieceState({ tone, title, body, action }: StateProps) {
  return (
    <div className={`ds-state ds-state--${tone}`}>
      <span className="ds-state__mark" aria-hidden="true" />
      <p className="ds-state__title" tabIndex={-1} data-result-focus>{title}</p>
      <p className="ds-state__body">{body}</p>
      {tone === 'loading' && (
        <div className="ds-skeleton" aria-hidden="true"><span /><span /><span /></div>
      )}
      {action && (
        <div className="ds-state__actions">
          <button type="button" className="ds-button" onClick={action.onClick}>{action.label}</button>
        </div>
      )}
    </div>
  )
}

function NoteList({ notes, stage }: { notes: ChangeNote[]; stage: ChangeStage }) {
  if (notes.length === 0) {
    return <p className="ds-help">The {STAGE_LABELS[stage]} step gave no reason that matches a real change, so none is shown.</p>
  }
  return (
    <ul className="notes" aria-label={`Why ${STAGE_LABELS[stage]} changed the text`}>
      {notes.map((note, i) => (
        <li key={i} className="notes__item">
          <span className="notes__text"><Inline text={note.text} /></span>
          <span className={`ds-chip ${note.side === 'new' ? 'ds-chip--add' : 'ds-chip--remove'}`} title={note.side === 'new' ? 'Words in the new text' : 'Words that were removed'}>
            {note.passage}
          </span>
        </li>
      ))}
    </ul>
  )
}

interface PieceProps {
  outputs: StageOutputs
  notes: Partial<Record<ChangeStage, ChangeNote[]>>
  running: boolean
  runningStage: StageId | null
  outcome: PipelineOutcome | null
  hasCalls: boolean
  copyNote: string
  onCopy: (label: string, text: string) => void
  onContinue: () => void
}

/** The piece is the page's lead: the final text, or the tracked changes that got it there. */
export default function Piece({ outputs, notes, running, runningStage, outcome, hasCalls, copyNote, onCopy, onContinue }: PieceProps) {
  const [view, setView] = useState<View>('final')
  const [changeStage, setChangeStage] = useState<ChangeStage>('polish')
  const best = bestStage(outputs)

  if (!best) {
    if (running) {
      const step = runningStage ? `${STAGE_LABELS[runningStage]} is running.` : 'Starting.'
      return (
        <section className="ds-section ds-run__result" aria-label="The piece" aria-live="polite">
          <PieceState tone="loading" title="Writing the piece" body={`${step} The draft appears here as soon as it is written.`} />
        </section>
      )
    }
    const label = outcome && outcome.kind !== 'complete' ? STAGE_LABELS[outcome.stage] : ''
    return (
      <section className="ds-section ds-run__result" aria-label="The piece" aria-live="polite">
        {outcome?.kind === 'failed' ? (
          <PieceState tone="error" title="The run failed" body={`${outcome.message} ${hasCalls ? 'The steps that ran are in the trace.' : 'No step had finished.'}`} action={{ label: `Retry from ${label}`, onClick: onContinue }} />
        ) : outcome?.kind === 'stopped' ? (
          <PieceState tone="stopped" title="Run stopped" body={`You stopped it before a draft was written. ${hasCalls ? 'The steps that finished are kept.' : 'No step had finished.'}`} action={{ label: `Resume from ${label}`, onClick: onContinue }} />
        ) : (
          <PieceState tone="empty" title="No piece yet" body="Generate looks up sources, writes a draft, then edits and polishes it. The finished piece, and every change between versions, appears here." />
        )}
      </section>
    )
  }

  const text = outputs[best] as string
  const body = best === 'polish' ? bodyOf(text) : text
  const pack = parseSourcePack(outputs.sources ?? '')
  const listed = best === 'polish' ? listedSources(text, pack) : { sources: [], cited: true }
  const noSources = best === 'polish' && pack.sources.length === 0
  const complete = outcome?.kind === 'complete'
  const comparison = compareStage(changeStage, outputs, notes)
  const changeOptions = CHANGE_STAGES.map(stage => ({ value: stage, label: FROM_LABEL[stage], disabled: compareStage(stage, outputs, notes) === null }))
  const activeView: View = view === 'changes' && changeOptions.some(o => !o.disabled) ? 'changes' : 'final'
  const stageForChanges = changeOptions.find(o => o.value === changeStage && !o.disabled) ? changeStage : (changeOptions.find(o => !o.disabled)?.value ?? changeStage)
  const shown = stageForChanges === changeStage ? comparison : compareStage(stageForChanges, outputs, notes)
  const label = complete ? 'Final piece' : `${STAGE_LABELS[best]} so far`
  const endLabel = outcome && outcome.kind !== 'complete' ? STAGE_LABELS[outcome.stage] : ''

  return (
    <section className="ds-section ds-run__result" aria-label="The piece" aria-live="polite">
      <div className="ds-lead">
        <div className="ds-lead__meta">
          <h2 className="ds-section__title" tabIndex={-1} data-result-focus>{label}</h2>
          <span className={`ds-badge ${complete ? 'ds-badge--success' : running ? 'ds-badge--accent' : 'ds-badge--warning'}`}>
            <span className={`ds-dot ${complete ? 'ds-dot--ok' : running ? 'ds-dot--running' : 'ds-dot--stopped'}`} aria-hidden="true" />
            {complete ? 'Polished' : running ? `${STAGE_LABELS[best]} done, writing on` : STAGE_LABELS[best]}
          </span>
        </div>

        {outcome && outcome.kind !== 'complete' && !running && (
          <div className="ds-state ds-state--partial">
            <span className="ds-state__mark" aria-hidden="true" />
            <p className="ds-state__title">{outcome.kind === 'failed' ? `${endLabel} did not finish` : `Stopped at ${endLabel}`}</p>
            <p className="ds-state__body">This is the {STAGE_LABELS[best]} version, not the finished piece. {outcome.kind === 'failed' ? outcome.message : ''} Finished steps are kept.</p>
            <div className="ds-state__actions">
              <button type="button" className="ds-button" onClick={onContinue}>{outcome.kind === 'failed' ? `Retry from ${endLabel}` : `Resume from ${endLabel}`}</button>
            </div>
          </div>
        )}

        <div className="piece-tools">
          <Seg
            idPrefix="view"
            label="Show the piece or its changes"
            value={activeView}
            onChange={setView}
            options={[{ value: 'final', label: 'Final' }, { value: 'changes', label: 'Changes', disabled: !changeOptions.some(o => !o.disabled) }]}
          />
          <button type="button" className="ds-button ds-button--quiet" onClick={() => onCopy(`${STAGE_LABELS[best]} text`, text)}>
            Copy {complete ? 'final piece' : STAGE_LABELS[best].toLowerCase()}
          </button>
        </div>

        <div role="tabpanel" id="view-panel" aria-labelledby={`view-${activeView}`} className="ds-stack">
          {activeView === 'final' ? (
            <>
              <Prose text={body} className="prose prose--lead" />
              {noSources && <p className="ds-help">No live source was found for this topic, so the facts above come from the model and are unchecked.</p>}
              {listed.sources.length > 0 && (
                <>
                  <p className="ds-label">{listed.cited ? 'Sources cited' : 'Sources consulted, not cited in the text'}</p>
                  <Cites sources={listed.sources} label="Sources" />
                </>
              )}
            </>
          ) : shown && (
            <>
              <div className="piece-tools">
                <Seg idPrefix="step" label="Which step to compare" value={stageForChanges} onChange={setChangeStage} options={changeOptions} />
                <div className="ds-chips" aria-label={`Counts for ${FROM_LABEL[shown.stage]}`}>
                  <span className="ds-chip ds-chip--add">{plural(shown.stats.added, 'word')} added</span>
                  <span className="ds-chip ds-chip--remove">{plural(shown.stats.removed, 'word')} removed</span>
                  <span className="ds-chip ds-chip--change">{plural(shown.stats.sentencesRewritten, 'sentence')} rewritten</span>
                </div>
              </div>
              <DiffView segments={shown.segments} />
              <p className="ds-label">Why {STAGE_LABELS[shown.stage]} made its main changes</p>
              <NoteList notes={shown.notes} stage={shown.stage} />
              <Readability points={readabilityTrend(outputs)} />
              <p className="ds-help">
                Added words are underlined, removed words are struck through. {shown.stage === 'polish' ? 'The Sources list is left out of the comparison. ' : ''}A reason is shown only when the words it names really changed.
              </p>
            </>
          )}
        </div>
        <p className="ds-lead__foot" aria-live="polite">{copyNote || `${plural(wordCount(body), 'word')}, Haiku 5.5 in every writing step.`}</p>
      </div>
    </section>
  )
}
