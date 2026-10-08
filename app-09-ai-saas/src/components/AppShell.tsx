import type { ReactNode } from 'react'

interface AppShellProps {
  /** One line under the app name saying what this screen does. */
  purpose: string
  badge?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

/** Header with the showcase callout, main, and the byline footer shared by every screen. */
export default function AppShell({ purpose, badge, actions, children }: AppShellProps) {
  return (
    <div className="ds-app">
      <header className="ds-header">
        <div className="ds-header__inner">
          <div className="hub-brand">
            <span className="hub-mark" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
                <rect x="3" y="3" width="26" height="26" rx="4" stroke="currentColor" strokeWidth="2" />
                <line x1="3" y1="11" x2="29" y2="11" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                <line x1="11" y1="11" x2="11" y2="29" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                <rect x="14" y="16" width="10" height="3" rx="0.5" fill="currentColor" />
                <rect x="14" y="22" width="5" height="3" rx="0.5" fill="currentColor" />
              </svg>
            </span>
            <div className="hub-brand__text">
              <h1 className="ds-title">InsightHub</h1>
              <p className="ds-subtitle">{purpose}</p>
            </div>
          </div>
          {(badge || actions) && (
            <div className="ds-row">
              {badge}
              {actions}
            </div>
          )}
          <p className="ds-showcase">
            <strong>What this showcases:</strong> a streamed AI analysis whose numbers are checked against the
            dashboard's own figures. The data is a seeded demo dataset, not customer data.
          </p>
        </div>
      </header>

      <main className="ds-main">{children}</main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
