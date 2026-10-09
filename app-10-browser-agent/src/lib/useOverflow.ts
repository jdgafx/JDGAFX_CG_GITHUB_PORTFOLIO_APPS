import { useEffect, useState, type RefObject } from 'react'

/** Which edges of a scroller have more content past them. Updates on scroll and when the box or its content changes size. */
export interface Edges {
  start: boolean
  end: boolean
}

/** The pure part: the edges for a scroller's measurements. `axis` picks the horizontal or vertical measurements. */
export function edgesOf(scroll: number, client: number, total: number): Edges {
  return { start: scroll > 1, end: scroll + client < total - 1 }
}

export function useEdges(ref: RefObject<HTMLElement | null>, axis: 'x' | 'y'): Edges {
  const [edges, setEdges] = useState<Edges>({ start: false, end: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const next = axis === 'x'
        ? edgesOf(el.scrollLeft, el.clientWidth, el.scrollWidth)
        : edgesOf(el.scrollTop, el.clientHeight, el.scrollHeight)
      setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    for (const child of Array.from(el.children)) observer.observe(child)
    el.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', measure)
    }
  })
  return edges
}

/**
 * Scroll position that brings `item` fully into view with the least movement, or null when it already is.
 * `itemLeft` is measured from the scroller's own left edge at scroll position 0, never from the page.
 */
export function nearestScroll(scrollLeft: number, clientWidth: number, itemLeft: number, itemWidth: number, gap = 8): number | null {
  if (itemLeft < scrollLeft) return Math.max(0, itemLeft - gap)
  if (itemLeft + itemWidth > scrollLeft + clientWidth) return itemLeft + itemWidth - clientWidth + gap
  return null
}

/** Where an item sits inside a scroller, from the two bounding boxes and the scroll offset. Page position cancels out. */
export function offsetInScroller(itemLeft: number, scrollerLeft: number, scrollLeft: number): number {
  return itemLeft - scrollerLeft + scrollLeft
}
