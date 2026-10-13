import { clock } from '../lib/liveData'
import type { WireState } from '../lib/useWikipediaLead'

/** The wire copy: what Wikipedia says about the example topic right now, drawn on load before any step runs. */
export default function WireCard({ lead, compact = false }: { lead: WireState; compact?: boolean }) {
  return (
    <section className={`wire ds-card${compact ? ' wire--compact' : ''}`} aria-label="From Wikipedia" aria-live="polite" data-wire={lead.status}>
      <div className="wire__head">
        <span className="ds-chip wire__tag">
          <span className={`ds-dot ${lead.status === 'ready' ? 'ds-dot--ok' : lead.status === 'failed' ? 'ds-dot--failed' : 'ds-dot--skipped'}`} aria-hidden="true" />
          {lead.status === 'ready' ? `Wikipedia, fetched ${clock(lead.at)}` : lead.status === 'failed' ? 'Wikipedia unavailable' : 'Reading Wikipedia'}
        </span>
      </div>
      {lead.status === 'ready' && (
        <div className={`wire__body${lead.lead.image && !compact ? ' wire__body--image' : ''}`}>
          <h2 className="wire__title">
            <a href={lead.lead.url} target="_blank" rel="noopener noreferrer">{lead.lead.title}</a>
          </h2>
          {lead.lead.description && <p className="wire__desc">{lead.lead.description}</p>}
          <p className="wire__extract">{lead.lead.extract}</p>
          {lead.lead.image && !compact && (
            <figure className="wire__fig">
              <img src={lead.lead.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
              {lead.lead.edited && <figcaption>Article last edited {lead.lead.edited}</figcaption>}
            </figure>
          )}
        </div>
      )}
      {lead.status === 'failed' && <p className="ds-help">The live lookup did not answer. Generate still looks up its own sources.</p>}
    </section>
  )
}
