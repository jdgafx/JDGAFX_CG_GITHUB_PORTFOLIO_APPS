import { CITE_VIEW_WORD, type CiteView } from '../../netlify/shared/citecheck'

/** One shape per state, so the badge reads without colour: check, cross, dash, dashed ring. */
function Shape({ view }: { view: CiteView }) {
  switch (view) {
    case 'confirmed':
      return <path d="M3 8.5 6.5 12 13 4.5" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    case 'not_confirmed':
      return <path d="M4 4l8 8M12 4l-8 8" fill="none" strokeWidth="2.2" strokeLinecap="round" />
    case 'not_checked':
      return <path d="M4 8h8" fill="none" strokeWidth="2.2" strokeLinecap="round" />
    case 'checking':
      return <circle cx="8" cy="8" r="5" fill="none" strokeWidth="1.8" strokeDasharray="3 2.4" />
  }
}

const TONE: Record<CiteView, string> = {
  confirmed: 'ds-badge--success',
  not_confirmed: 'ds-badge--danger',
  not_checked: '',
  checking: 'ds-badge--accent',
}

/** The state of one cited sentence: mark and word, in the shared badge classes. */
export default function CiteBadge({ view }: { view: CiteView }) {
  return (
    <span className={`ds-badge cite-badge ${TONE[view]}`.trim()} data-cite={view}>
      <svg className="cite-mark" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" stroke="currentColor" fill="currentColor">
        <Shape view={view} />
      </svg>
      {CITE_VIEW_WORD[view]}
    </span>
  )
}
