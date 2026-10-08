import type { PlanItem, PlanStatus } from '../lib/trace'

const WORD: Record<PlanStatus, string> = {
  waiting: 'Waiting',
  running: 'Running',
  ok: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
}

const DOT: Record<PlanStatus, string> = {
  waiting: 'ds-dot',
  running: 'ds-dot ds-dot--running',
  ok: 'ds-dot ds-dot--ok',
  failed: 'ds-dot ds-dot--failed',
  skipped: 'ds-dot ds-dot--skipped',
}

interface PlanRailProps {
  items: PlanItem[]
}

/** The plan as a pipeline. The edge after a finished step turns signal colour, so the taken path stays visible. */
export default function PlanRail({ items }: PlanRailProps) {
  if (items.length === 0) {
    return <div className="ds-empty">No plan yet. Plan and run turns the task into steps.</div>
  }

  return (
    <ol className="bb-rail" aria-label="Planned steps">
      {items.map((item) => (
        <li key={item.key} className={`bb-node bb-node--${item.status}`}>
          <span className={DOT[item.status]} aria-hidden="true" />
          <div className="bb-node__body">
            <div className="bb-node__label">{item.label}</div>
            <div className="bb-node__state">{WORD[item.status]}</div>
            <div className="ds-help">{item.thought}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}
