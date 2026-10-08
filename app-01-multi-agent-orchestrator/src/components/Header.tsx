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
          <p className="ds-subtitle">Four model calls in order: research, analysis, critique, synthesis.</p>
        </div>
        <span className={badgeClass}>{badgeLabel}</span>
      </div>
    </header>
  )
}
