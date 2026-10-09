export interface Badge {
  label: string
  tone: string
  dot: string
}

interface HeaderProps {
  badge: Badge
}

/** The masthead: number plate, name, a status lamp that follows the run, and the one line on what this app shows. */
export function Header({ badge }: HeaderProps) {
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 02">
              02
            </span>
            <h1 className="ds-title">DocMind</h1>
            <span className={`ds-badge ${badge.tone}`}>
              <span className={`ds-dot ${badge.dot}`} aria-hidden="true" />
              {badge.label}
            </span>
          </div>
          <p className="ds-subtitle">
            Ask a Wikipedia article, an arXiv paper or your own file. Click a citation to read its sentence.
          </p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> retrieval you can check. BM25 picks the passages in your browser, the
          model cites them, and each citation opens the exact supporting sentence.
        </p>
      </div>
    </header>
  )
}
