export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

interface HeaderProps {
  badgeLabel: string
  badgeTone: BadgeTone
}

export function Header({ badgeLabel, badgeTone }: HeaderProps) {
  const badgeClass = badgeTone === 'neutral' ? 'ds-badge' : `ds-badge ds-badge--${badgeTone}`
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div>
          <h1 className="ds-title">AgentFlow</h1>
          <p className="ds-subtitle">Looks a question up on Wikipedia and Hacker News, then answers it with a researcher, an analyst, a critic and a synthesizer.</p>
        </div>
        <span className={badgeClass}>{badgeLabel}</span>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> live public sources, then four model calls in order. The report cites the
          sources, and each step is traced with its own time, tokens and cost.
        </p>
      </div>
    </header>
  )
}
