export interface BadgeInfo {
  label: string
  tone: 'success' | 'accent' | 'muted'
  dot: string
}

interface HeaderProps {
  badge: BadgeInfo
}

export default function Header({ badge }: HeaderProps) {
  const badgeClass = badge.tone === 'muted' ? 'ds-badge' : `ds-badge ds-badge--${badge.tone}`
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="vox-brand">
          <h1 className="ds-title">VoxAI</h1>
          <p className="ds-subtitle">
            Ask by voice or by typing. Deepgram hears the question, one chat model answers, and the browser reads the
            reply aloud.
          </p>
        </div>
        <span className={badgeClass}>
          <span className={badge.dot} aria-hidden="true" />
          {badge.label}
        </span>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a voice loop, speech to text on the server, a chat model that calls live public data, and browser
          speech back, with each step timed.
        </p>
      </div>
    </header>
  )
}
