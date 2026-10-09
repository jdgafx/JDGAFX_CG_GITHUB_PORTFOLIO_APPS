import type { Priority } from '../types'

/** A list of label chips, or a plain "none" line. */
export function Chips({ items, empty }: { items: readonly string[]; empty: string }) {
  if (items.length === 0) return <span className="ds-help">{empty}</span>
  return (
    <span className="ds-chips">
      {items.map((item) => (
        <span key={item} className="ds-chip">
          {item}
        </span>
      ))}
    </span>
  )
}

const TONE: Record<Priority, string> = {
  urgent: 'ds-badge ds-badge--danger',
  high: 'ds-badge ds-badge--warning',
  medium: 'ds-badge ds-badge--accent',
  low: 'ds-badge',
}

/** The priority as a word in a pill; urgent carries a mark so it never rests on colour alone. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={TONE[priority]}>
      {priority === 'urgent' ? <span aria-hidden="true">! </span> : null}
      {priority}
    </span>
  )
}
