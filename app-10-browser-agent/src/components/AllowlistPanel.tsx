import { ALLOWED_SITE_NOTES } from '../lib/constants'

/** The only sites the browser may visit, each with a line on what it is for. */
export default function AllowlistPanel() {
  return (
    <details className="ds-disclosure">
      <summary>Allowed sites ({ALLOWED_SITE_NOTES.length})</summary>
      <ul className="bb-allowlist">
        {ALLOWED_SITE_NOTES.map((site) => (
          <li key={site.host} className="bb-site">
            <span className="bb-site__host">{site.host}</span>
            <span className="bb-site__note">{site.note}</span>
          </li>
        ))}
      </ul>
      <p className="ds-help">The only sites the browser may visit, subdomains included. A page that moves elsewhere stops the run.</p>
    </details>
  )
}
