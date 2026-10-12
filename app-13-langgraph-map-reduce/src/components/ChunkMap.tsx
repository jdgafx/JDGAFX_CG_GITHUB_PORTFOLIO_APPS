import { useState } from 'react'
import type { ChunkSummary } from '../lib/chunkMap'
import { formatCount, formatTokens } from '../lib/format'
import type { Branch, Status } from '../lib/view'

const DOT: Record<Status, string> = {
  idle: '',
  running: 'ds-dot ds-dot--running',
  ok: 'ds-dot ds-dot--ok',
  failed: 'ds-dot ds-dot--failed',
  stopped: 'ds-dot ds-dot--stopped',
}
const WORD: Record<Status, string> = { idle: 'waiting', running: 'extracting', ok: 'extracted', failed: 'failed', stopped: 'stopped' }

interface Props {
  summary: ChunkSummary
  /** Where the text came from, in words: "the Wikipedia article Apollo 11", "your text". */
  source: string
  /** The example article is still on its way from Wikipedia. */
  loading: boolean
  /** Why the example could not be fetched, if it could not. */
  loadError: string | null
  onReload: () => void
  branches: readonly Branch[]
  reduce: Status
  /** True before any run has started: the line then says no model has run. */
  idle: boolean
}

/** Position of each chunk's centre on the strip, in percent of the document. */
function centres(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0) || 1
  let used = 0
  return sizes.map((s) => {
    const mid = ((used + s / 2) / total) * 100
    used += s
    return mid
  })
}

/**
 * The document as the graph will see it: one strip cut where the splitter cuts, one tile per chunk fanned out under it,
 * and the point where the results merge. Counts, sizes and boundaries are the real splitter's, drawn before any model call.
 */
export function ChunkMap({ summary, source, loading, loadError, onReload, branches, reduce, idle }: Props) {
  const [picked, setPicked] = useState(1)
  const { facts, count } = summary
  // A new text can have fewer chunks than the one before it: the pick then falls back to the first.
  const open = facts.find((f) => f.id === picked) ?? facts[0]
  const statusOf = (id: number): Status => branches.find((b) => b.chunk === id)?.status ?? 'idle'
  const from = centres(facts.map((f) => f.chars))
  const to = facts.map((_f, i) => ((i + 0.5) / count) * 100)

  return (
    <section className="ds-section cm" aria-labelledby="map-title" aria-busy={loading}>
      <div className="ds-section__head ds-section__head--row ds-section__head--bare">
        <h2 id="map-title" className="ds-section__title">
          Chunk map
        </h2>
        <p className="ds-help cm__line" role="status">
          {loading
            ? 'Fetching the example article from Wikipedia.'
            : count > 0
              ? `${formatCount(count, 'chunk')} from ${source}, ${formatTokens(summary.smallest)} to ${formatTokens(summary.largest)} characters each, ${formatTokens(summary.chars)} in all.${idle ? ' No model has run yet.' : ''}`
              : ''}
        </p>
      </div>

      {count > 0 && open ? (
        <div className="cm__sheet">
          <div className="cm__strip" aria-hidden="true">
            {facts.map((f) => (
              <i key={f.id} className={f.id === open.id ? 'cm__cut cm__cut--on' : 'cm__cut'} style={{ flexGrow: f.chars }} />
            ))}
          </div>
          <svg className="cm__fan" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
            {facts.map((f, i) => (
              <path
                key={f.id}
                className={f.id === open.id ? 'cm__lead cm__lead--on' : 'cm__lead'}
                d={`M${from[i]} 0 C${from[i]} 24 ${to[i]} 16 ${to[i]} 40`}
              />
            ))}
          </svg>
          <div className="cm__tiles" role="group" aria-label="Chunks of the document" style={{ ['--n' as string]: count }}>
            {facts.map((f) => {
              const status = statusOf(f.id)
              return (
                <button
                  key={f.id}
                  type="button"
                  className="cm__tile"
                  data-status={status}
                  aria-pressed={f.id === open.id}
                  aria-label={`Chunk ${f.id}, ${formatTokens(f.chars)} characters, ${WORD[status]}`}
                  onClick={() => setPicked(f.id)}
                >
                  <span className="cm__id">{f.id}</span>
                  <span className="cm__size">{formatTokens(f.chars)}</span>
                  <span className="cm__bar" aria-hidden="true">
                    <i style={{ width: `${Math.max(6, f.share * 100)}%` }} />
                  </span>
                  {status !== 'idle' ? <span className={DOT[status]} aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
          <svg className="cm__fan cm__fan--merge" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
            {to.map((x) => (
              <path key={x} className="cm__lead cm__lead--merge" d={`M${x} 0 C${x} 18 50 14 50 32`} />
            ))}
          </svg>
          <p className="cm__merge" data-status={reduce}>
            <span className="cm__node">Reduce</span>
            <span>
              merges the findings of {formatCount(count, 'chunk')} into one summary
              {reduce === 'running' ? ' (merging now)' : reduce === 'ok' ? ' (done)' : ''}
            </span>
          </p>

          <dl className="cm__open" aria-live="polite">
            <div>
              <dt>
                Chunk {open.id} of {count}
              </dt>
              <dd>
                {formatTokens(open.chars)} characters, {formatTokens(open.words)} words
              </dd>
            </div>
            <div>
              <dt>Starts</dt>
              <dd>“{open.start}”</dd>
            </div>
            <div>
              <dt>Ends</dt>
              <dd>“{open.end}”</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="ds-state ds-state--empty cm__empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">{loading ? 'Waiting for Wikipedia' : loadError ? 'The example article did not load' : 'No chunks yet'}</p>
          <p className="ds-state__body">
            {loading
              ? 'The text is fetched live, then split here in your browser.'
              : (loadError ?? 'Load a Wikipedia article or paste 200 to 20,000 characters to see where the text is cut.')}
          </p>
          {loadError ? (
            <div className="ds-state__actions">
              <button type="button" className="ds-button" onClick={onReload}>
                Load the article again
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
