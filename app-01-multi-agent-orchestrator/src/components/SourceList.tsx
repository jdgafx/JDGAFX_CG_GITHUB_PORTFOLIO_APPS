import type { Source } from '../types'

/** The sources one run retrieved, numbered as the Researcher cites them, each with the extract the model saw. */
export function SourceList({ sources }: { sources: Source[] }) {
  return (
    <ol className="source-list">
      {sources.map(source => (
        <li key={source.n} id={`source-${source.n}`}>
          <span className="ds-cite__n">[{source.n}]</span>
          <a className="ds-cite__title" href={source.url} target="_blank" rel="noreferrer noopener">
            {source.title}
          </a>
          <span className="ds-cite__url">{source.note ? `${source.site}, ${source.note}` : source.site}</span>
          <p className="source-list__snippet">{source.snippet}</p>
        </li>
      ))}
    </ol>
  )
}
