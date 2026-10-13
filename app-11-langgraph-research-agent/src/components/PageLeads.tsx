import type { PageLeadsState } from '../lib/pageLeads'

const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

interface PageLeadsProps {
  state: PageLeadsState
}

/** The pages the example question reads, drawn from live Wikipedia at once on load. The agent picks its own pages when it runs. */
export function PageLeads({ state }: PageLeadsProps) {
  return (
    <section className="ds-section ds-run__pages" aria-labelledby="pages-title" data-state={state.status}>
      <div className="ds-section__head ds-section__head--row ds-section__head--bare">
        <h2 id="pages-title" className="ds-section__title">
          From the shelf
        </h2>
        <p className="ds-section__sub">
          {state.status === 'ready'
            ? `The example question's pages, live from Wikipedia at ${clock(state.at)}. No model was asked.`
            : state.status === 'failed'
              ? 'Wikipedia did not answer. The example still runs: the agent searches it itself.'
              : 'Fetching the example question’s pages from Wikipedia.'}
        </p>
      </div>
      {state.status === 'ready' && (
        <ul className="leads">
          {state.leads.map((lead) => (
            <li key={lead.url} className="leads__item">
              <a className="leads__title" href={lead.url} target="_blank" rel="noopener noreferrer">
                {lead.title}
              </a>
              {lead.description && <span className="leads__desc">{lead.description}</span>}
              <p className="leads__text">{lead.extract}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
