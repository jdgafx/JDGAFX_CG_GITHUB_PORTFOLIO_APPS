import { ALLOWED_SITE_NOTES } from '../lib/constants'

/** The only sites the browser may visit, each with a line on what it is for. */
export default function AllowlistPanel() {
  return (
    <section className="ds-section" aria-labelledby="sites-heading">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="sites-heading">Allowed sites</h2>
        <p className="ds-section__sub">Every run stays inside these hosts.</p>
      </div>
      <ul className="bb-allowlist" aria-describedby="sites-help">
        {ALLOWED_SITE_NOTES.map((site) => (
          <li key={site.host} className="bb-site">
            <span className="bb-site__host">{site.host}</span>
            <span className="bb-site__note">{site.note}</span>
          </li>
        ))}
      </ul>
      <p className="ds-help" id="sites-help">
        The only sites the browser may visit, subdomains included. A page that moves elsewhere stops the run.
      </p>
    </section>
  )
}
