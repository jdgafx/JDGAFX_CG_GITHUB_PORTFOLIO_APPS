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
          <p className="ds-subtitle">Answers one research question with a researcher, an analyst, a critic and a synthesizer.</p>
        </div>
        <span className={badgeClass}>{badgeLabel}</span>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a fixed multi-agent pipeline, four model calls in order, each stage traced with its
          own tokens and cost.
        </p>
      </div>
    </header>
  )
}
