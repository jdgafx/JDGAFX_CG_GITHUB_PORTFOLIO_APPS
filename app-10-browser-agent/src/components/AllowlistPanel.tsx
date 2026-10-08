import { ALLOWED_SITES } from '../lib/constants'

/** The only sites the browser may visit, listed plainly. */
export default function AllowlistPanel() {
  return (
    <section className="ds-section" aria-labelledby="sites-heading">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="sites-heading">Allowed sites</h2>
        <p className="ds-section__sub">Every run stays inside these hosts.</p>
      </div>
      <ul className="bb-allowlist" aria-describedby="sites-help">
        {ALLOWED_SITES.map((site) => (
          <li key={site}>{site}</li>
        ))}
      </ul>
      <p className="ds-help" id="sites-help">
        The only sites the browser may visit, subdomains included. A page that moves elsewhere stops the run.
      </p>
    </section>
  )
}
