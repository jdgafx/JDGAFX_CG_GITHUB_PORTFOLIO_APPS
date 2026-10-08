export type BadgeTone = 'success' | 'accent' | 'danger' | 'muted'

interface HeaderProps {
  badge: string
  tone: BadgeTone
}

export default function Header({ badge, tone }: HeaderProps) {
  const badgeClass = tone === 'muted' ? 'ds-badge' : `ds-badge ds-badge--${tone}`
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="vox-brand">
          <h1 className="ds-title">VoxAI</h1>
          <p className="ds-subtitle">Ask by voice or text. Deepgram transcribes, OpenRouter answers.</p>
        </div>
        <span className={badgeClass}>{badge}</span>
      </div>
    </header>
  )
}
