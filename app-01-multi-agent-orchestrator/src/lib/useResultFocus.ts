import { useEffect, useRef } from 'react'

/** Run phases the hook understands. Any app with a run lifecycle maps its own phases onto these names. */
export type RunPhase = 'idle' | 'running' | 'done' | 'failed' | 'stopped'

const WIDE = '(min-width: 1000px)'
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', ' ', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

/** Keys that scroll the page when nothing is being typed. Typing in a field never counts as scrolling. */
export function isScrollKey(key: string, target: EventTarget | null): boolean {
  if (!SCROLL_KEYS.has(key)) return false
  const element = target as HTMLElement | null
  const tag = element?.tagName
  return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element?.isContentEditable)
}

/** The decision when a run ends: bring the result into view only on a narrow screen and only if the visitor stayed put. */
export function shouldBringIntoView(narrow: boolean, visitorScrolled: boolean): boolean {
  return narrow && !visitorScrolled
}

interface Options {
  /** Called when a run starts; use it to close open example or preset lists on a narrow screen. */
  onRunStart?: (narrow: boolean) => void
}

/**
 * When a run ends (done, failed or stopped): on a narrow screen, scroll the element marked `data-result-focus` (the
 * result's heading, with `tabIndex={-1}`) into view at the top of its result block `.ds-run__result`, unless the
 * visitor scrolled during the run; then move focus to it when focus has fallen to the page, without scrolling.
 * The visitor's intent is read from wheel, touch and scroll-key events, never from the scroll position, because the
 * browser and focus changes also move the page. Reduced motion gets an instant scroll.
 */
export function useResultFocus(phase: RunPhase, options: Options = {}): void {
  const previous = useRef<RunPhase>(phase)
  const scrolled = useRef(false)
  const onRunStart = useRef(options.onRunStart)
  useEffect(() => {
    onRunStart.current = options.onRunStart
  })

  useEffect(() => {
    const was = previous.current
    previous.current = phase

    if (phase === 'running') {
      scrolled.current = false
      onRunStart.current?.(!window.matchMedia(WIDE).matches)
      const mark = () => {
        scrolled.current = true
      }
      const markKey = (event: KeyboardEvent) => {
        if (isScrollKey(event.key, event.target)) scrolled.current = true
      }
      window.addEventListener('wheel', mark, { passive: true })
      window.addEventListener('touchmove', mark, { passive: true })
      window.addEventListener('keydown', markKey, { passive: true })
      return () => {
        window.removeEventListener('wheel', mark)
        window.removeEventListener('touchmove', mark)
        window.removeEventListener('keydown', markKey)
      }
    }

    if (was !== 'running') return
    const target = document.querySelector<HTMLElement>('[data-result-focus]')
    if (!target) return
    const narrow = !window.matchMedia(WIDE).matches
    if (shouldBringIntoView(narrow, scrolled.current)) {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      target.closest('.ds-run__result')?.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
    }
    const active = document.activeElement
    if (!active || active === document.body) target.focus({ preventScroll: true })
  }, [phase])
}
