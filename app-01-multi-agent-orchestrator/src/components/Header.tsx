import { useEffect, useRef } from 'react'
import type { LiveDataView } from '../lib/liveData'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

interface HeaderProps {
  badgeLabel: string
  badgeTone: BadgeTone
  live: LiveDataView
  /** A run or an audit is in progress: Stop shows, and the masthead sticks where the window allows. */
  busy: boolean
  /** A research run is going (Stop); when only the audit is going, the button reads "Stop audit". */
  running: boolean
  onStop: () => void
}

const DOT: Record<BadgeTone, string> = {
  neutral: '',
  accent: 'ds-dot--running',
  success: 'ds-dot--ok',
  warning: 'ds-dot--stopped',
  danger: 'ds-dot--failed',
}

/** The masthead: the mark and name, the run status, the data chip that says whether the sources on screen are live or recorded, and Stop. */
export function Header({ badgeLabel, badgeTone, live, busy, running, onStop }: HeaderProps) {
  const headerRef = useRef<HTMLElement>(null)
  const stopRef = useRef<HTMLButtonElement>(null)

  // Focus follows the action: Stop takes focus when a run starts, without moving the page.
  useEffect(() => {
    if (running) stopRef.current?.focus({ preventScroll: true })
  }, [running])

  // While busy, the masthead's height is a CSS variable, so scrolled-to content and the sticky source panel land below it when it sticks.
  useEffect(() => {
    const el = headerRef.current
    if (!busy || !el || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const write = () => root.style.setProperty('--relay-head-h', `${el.offsetHeight}px`)
    write()
    const observer = new ResizeObserver(write)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--relay-head-h')
    }
  }, [busy])

  return (
    <header className="ds-header" ref={headerRef} data-busy={busy ? 'true' : undefined}>
      <div className="ds-header__inner">
        <div className="relay-brand">
          <span className="relay-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M13 2L3 14h7v8l11-12h-8z" fill="currentColor" />
            </svg>
          </span>
          <p className="relay-wordmark">AgentFlow</p>
          <span className={badgeTone === 'neutral' ? 'ds-badge' : `ds-badge ds-badge--${badgeTone}`}>
            <span className={`ds-dot ${DOT[badgeTone]}`} aria-hidden="true" />
            {badgeLabel}
          </span>
        </div>
        <p className="ds-chip live-data" data-state={live.state} role="status" aria-live="polite" title={live.title}>
          <span className={`ds-dot ${live.state === 'live' ? 'ds-dot--ok' : live.state === 'failed' ? 'ds-dot--failed' : 'ds-dot--skipped'}`} aria-hidden="true" />
          {live.text}
        </p>
        {busy ? (
          <button type="button" className="ds-button relay-stop" onClick={onStop} ref={stopRef}>
            {running ? 'Stop' : 'Stop audit'}
          </button>
        ) : (
          <span className="relay-stop" aria-hidden="true" />
        )}
      </div>
    </header>
  )
}
