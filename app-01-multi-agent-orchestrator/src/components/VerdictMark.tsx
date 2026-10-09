import { VERDICT_VIEW } from '../lib/verdict'
import type { Verdict } from '../types'

/** One shape per verdict, so the badge reads without colour: check, half circle, cross, dash, open ring. */
function Shape({ verdict }: { verdict: Verdict }) {
  switch (verdict) {
    case 'supported':
      return <path d="M3 8.5 6.5 12 13 4.5" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    case 'partly':
      return (
        <>
          <circle cx="8" cy="8" r="5.5" fill="none" strokeWidth="1.8" />
          <path d="M8 2.5a5.5 5.5 0 0 0 0 11z" stroke="none" />
        </>
      )
    case 'unsupported':
      return <path d="M4 4l8 8M12 4l-8 8" fill="none" strokeWidth="2.2" strokeLinecap="round" />
    case 'unchecked':
      return <path d="M4 8h8" fill="none" strokeWidth="2.2" strokeLinecap="round" />
    case 'checking':
      return <circle cx="8" cy="8" r="5" fill="none" strokeWidth="1.8" strokeDasharray="3 2.4" />
  }
}

export function VerdictMark({ verdict }: { verdict: Verdict }) {
  return (
    <svg className="verdict-mark" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" stroke="currentColor" fill="currentColor">
      <Shape verdict={verdict} />
    </svg>
  )
}

/** The badge: mark and word. `short` is the form used inline in the report. */
export function VerdictBadge({ verdict, short = false }: { verdict: Verdict; short?: boolean }) {
  const view = VERDICT_VIEW[verdict]
  return (
    <span className="verdict" data-verdict={verdict}>
      <VerdictMark verdict={verdict} />
      {short ? view.short : view.word}
    </span>
  )
}
