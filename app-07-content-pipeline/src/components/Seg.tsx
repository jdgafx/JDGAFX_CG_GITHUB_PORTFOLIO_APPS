import { useRef, type KeyboardEvent } from 'react'

interface SegProps<T extends string> {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>
  onChange: (value: T) => void
  idPrefix: string
  // The small size, for a choice that sits under another one.
  small?: boolean
}

// The family's segmented control (ds-seg) as tabs: arrow keys move between options, Home and End jump.
export default function Seg<T extends string>({ label, value, options, onChange, idPrefix, small }: SegProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const enabled = options.map((option, i) => (option.disabled ? -1 : i)).filter(i => i >= 0)

  function onKeyDown(event: KeyboardEvent) {
    const at = enabled.indexOf(options.findIndex(option => option.value === value))
    let next = -1
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (at + 1) % enabled.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (at - 1 + enabled.length) % enabled.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = enabled.length - 1
    if (next < 0 || enabled.length === 0) return
    event.preventDefault()
    const index = enabled[next] as number
    onChange((options[index] as { value: T }).value)
    refs.current[index]?.focus()
  }

  return (
    <div className={small ? 'ds-seg ds-seg--small' : 'ds-seg'} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={el => { refs.current[i] = el }}
          type="button"
          role="tab"
          id={`${idPrefix}-${option.value}`}
          aria-selected={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
