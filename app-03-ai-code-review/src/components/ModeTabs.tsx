import type { KeyboardEvent } from 'react'

export type Mode = 'file' | 'pr'

const TABS: ReadonlyArray<{ mode: Mode; label: string }> = [
  { mode: 'file', label: 'File' },
  { mode: 'pr', label: 'Pull request' },
]

interface ModeTabsProps {
  mode: Mode
  disabled: boolean
  onChange: (mode: Mode) => void
}

/** What to review. Arrow keys move between the two; the selected tab is the one the panel below belongs to. */
export function ModeTabs({ mode, disabled, onChange }: ModeTabsProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return
    event.preventDefault()
    const next = mode === 'file' ? 'pr' : 'file'
    onChange(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`#tab-${next}`)?.focus()
  }
  return (
    <div className="ds-field">
      <div className="ds-seg mode-tabs" role="tablist" aria-label="What to review" onKeyDown={onKeyDown}>
        {TABS.map((tab) => (
          <button
            key={tab.mode}
            id={`tab-${tab.mode}`}
            type="button"
            role="tab"
            aria-selected={mode === tab.mode}
            aria-controls="source-panel"
            tabIndex={mode === tab.mode ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(tab.mode)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}
