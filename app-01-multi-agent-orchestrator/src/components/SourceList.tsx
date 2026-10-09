import type { Source } from '../types'

/** The sources one run retrieved, numbered as the Researcher cites them. Links open in a new tab. */
export function SourceList({ sources }: { sources: Source[] }) {
  return (
    <ol className="source-list">
      {sources.map(source => (
        <li key={source.n} id={`source-${source.n}`} className="source-list__item">
          <span className="source-list__index ds-num">[{source.n}]</span>
          <div className="source-list__body">
            <a className="source-list__title" href={source.url} target="_blank" rel="noreferrer noopener">
              {source.title}
            </a>
            <div className="source-list__site">
              {source.site}
              {source.note ? `, ${source.note}` : ''}
            </div>
            <p className="source-list__snippet">{source.snippet}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
