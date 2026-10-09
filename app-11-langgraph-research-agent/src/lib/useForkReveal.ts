import { useEffect, useRef } from 'react'
import type { Phase } from './runState'

/**
 * A rewind starts from a button far below the answer, so on a wide screen the fork result can finish above the
 * viewport (the shared result-focus hook only scrolls on narrow ones). When the re-run ends and the visitor has
 * not scrolled during it, bring the fork block to the top if its top edge is off screen.
 */
export function useForkReveal(phase: Phase): void {
  const previous = useRef<Phase>(phase)
  const scrolled = useRef(false)
  useEffect(() => {
    const was = previous.current
    previous.current = phase
    if (phase === 'running') {
      scrolled.current = false
      const mark = () => {
        scrolled.current = true
      }
      window.addEventListener('wheel', mark, { passive: true })
      window.addEventListener('touchmove', mark, { passive: true })
      return () => {
        window.removeEventListener('wheel', mark)
        window.removeEventListener('touchmove', mark)
      }
    }
    if (was !== 'running' || scrolled.current) return
    const block = document.querySelector<HTMLElement>('.fork')
    if (!block || block.getBoundingClientRect().top >= 0) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    block.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
  }, [phase])
}
