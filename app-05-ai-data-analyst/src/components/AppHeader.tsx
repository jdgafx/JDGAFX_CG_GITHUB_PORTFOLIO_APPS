export type HeaderStatus = 'idle' | 'running' | 'done' | 'failed' | 'stopped'

const STATUS: Record<HeaderStatus, { label: string; tone: string }> = {
  idle: { label: 'Ready for a question', tone: '' },
  running: { label: 'Planning and running', tone: 'ds-badge--accent' },
  done: { label: 'Last run completed', tone: 'ds-badge--success' },
  failed: { label: 'Last run failed', tone: 'ds-badge--danger' },
  stopped: { label: 'Last run stopped', tone: '' },
}

export default function AppHeader({ status }: { status: HeaderStatus }) {
  const { label, tone } = STATUS[status]
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div>
          <h1 className="ds-title">DataPilot</h1>
          <p className="ds-subtitle">Ask a question about a CSV and get a chart with the numbers behind it.</p>
        </div>
        <span className={`ds-badge ${tone}`}>{label}</span>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> the model plans, the browser computes. A query plan is validated against
          the columns and executed deterministically over every row.
        </p>
      </div>
    </header>
  )
}
