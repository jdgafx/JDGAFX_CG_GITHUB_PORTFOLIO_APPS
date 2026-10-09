import { KIND_LABELS, parseSourcePack, type Source } from '../../netlify/shared/sourcepack'

function metaFor(source: Source): string {
  if (source.kind === 'wikipedia') return 'Article introduction'
  return [source.points === undefined ? '' : `${source.points.toLocaleString('en-US')} points`, source.date ?? ''].filter(Boolean).join(' · ')
}

function hostOf(url: string): string {
  return new URL(url).host.replace(/^www\./, '')
}

// The Sources stage output as numbered cards. The numbers are the ones the writing stages cite.
export default function SourceList({ text }: { text: string }) {
  const { sources, notes } = parseSourcePack(text)

  return (
    <div className="source-panel">
      {sources.length === 0 ? (
        <p className="ds-notice source-none">
          <strong>No live sources were found.</strong> The piece is written from model knowledge alone and says so at its end. Nothing here is cited.
        </p>
      ) : (
        <ol className="source-list" aria-label="Sources found">
          {sources.map(source => (
            <li key={source.n} className="source-card">
              <span className="source-card__n ds-num" aria-label={`Source ${source.n}`}>{source.n}</span>
              <div className="source-card__body">
                <div className="source-card__top">
                  <span className={`ds-badge source-kind source-kind--${source.kind}`}>{KIND_LABELS[source.kind]}</span>
                  <span className="source-card__meta ds-num">{metaFor(source)}</span>
                </div>
                <a className="source-card__title" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
                {source.summary && <p className="source-card__summary">{source.summary}</p>}
                <span className="source-card__host ds-mono">{hostOf(source.url)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {notes.length > 0 && (
        <ul className="source-notes" aria-label="Lookup notes">
          {notes.map(note => <li key={note}>{note}</li>)}
        </ul>
      )}
    </div>
  )
}
