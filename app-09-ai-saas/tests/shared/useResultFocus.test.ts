import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A minimal stand-in for React's hooks so the hook runs in the node test environment: refs keep their value across
// renders and an effect re-runs only when its dependency list changed.
const slots = vi.hoisted(() => ({ refs: [] as { current: unknown }[], effects: [] as { deps?: unknown[]; cleanup?: () => void }[], pending: [] as (() => void)[], r: 0, e: 0 }))
vi.mock('react', () => ({
  useRef: (initial: unknown) => (slots.refs[slots.r] ??= { current: initial }, slots.refs[slots.r++]),
  useEffect: (run: () => void | (() => void), deps?: unknown[]) => {
    const slot = (slots.effects[slots.e] ??= {})
    slots.e++
    const changed = !deps || !slot.deps || deps.some((d, i) => d !== slot.deps?.[i])
    if (!changed) return
    slot.deps = deps
    slots.pending.push(() => {
      slot.cleanup?.()
      const cleanup = run()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    })
  },
}))

import { isInView, isScrollKey, shouldBringIntoView, useResultFocus, type RunPhase } from '../../src/replay'

describe('shouldBringIntoView', () => {
  it('scrolls only on a narrow screen and only when the visitor did not scroll', () => {
    expect(shouldBringIntoView(true, false)).toBe(true)
    expect(shouldBringIntoView(true, true)).toBe(false)
    expect(shouldBringIntoView(false, false)).toBe(false)
    expect(shouldBringIntoView(false, true)).toBe(false)
  })

  it('does not scroll when the heading is already in view', () => {
    expect(shouldBringIntoView(true, false, true)).toBe(false)
    expect(shouldBringIntoView(true, false, false)).toBe(true)
  })
})

describe('isInView', () => {
  it('is true only when the whole element sits inside the viewport', () => {
    expect(isInView({ top: 100, bottom: 160 }, 844)).toBe(true)
    expect(isInView({ top: 800, bottom: 900 }, 844)).toBe(false)
    expect(isInView({ top: -10, bottom: 40 }, 844)).toBe(false)
  })
})

describe('useResultFocus on a narrow screen', () => {
  const scrollIntoView = vi.fn()
  const focus = vi.fn()
  let rect = { top: 1500, bottom: 1540 }

  function useRender(phase: RunPhase, options: { replay?: boolean } = {}) {
    slots.r = 0
    slots.e = 0
    useResultFocus(phase, options)
    const run = slots.pending.splice(0)
    for (const effect of run) effect()
  }

  beforeEach(() => {
    slots.refs.length = 0
    slots.effects.length = 0
    slots.pending.length = 0
    scrollIntoView.mockClear()
    focus.mockClear()
    rect = { top: 1500, bottom: 1540 }
    const target = { closest: () => ({ scrollIntoView }), getBoundingClientRect: () => rect, focus }
    vi.stubGlobal('window', {
      innerHeight: 844,
      matchMedia: (query: string) => ({ matches: query.includes('reduce') ? false : false }),
      addEventListener: () => {},
      removeEventListener: () => {},
    })
    vi.stubGlobal('document', { querySelector: () => target, activeElement: null, body: {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('brings a live result into view when it is below the fold', () => {
    useRender('idle')
    useRender('running')
    useRender('done')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('does not scroll when the live result heading is already in view', () => {
    rect = { top: 300, bottom: 340 }
    useRender('idle')
    useRender('running')
    useRender('done')
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('never scrolls for the load-time replay, but still moves focus', () => {
    useRender('idle', { replay: true })
    useRender('running', { replay: true })
    useRender('done', { replay: true })
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('scrolls again for a live run that follows a replay', () => {
    useRender('idle', { replay: true })
    useRender('running', { replay: true })
    useRender('done', { replay: true })
    useRender('running', { replay: false })
    useRender('done', { replay: false })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })
})

describe('isScrollKey', () => {
  it('counts the keys that scroll a page', () => {
    for (const key of ['PageUp', 'PageDown', ' ', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(isScrollKey(key, null)).toBe(true)
    }
  })

  it('ignores other keys', () => {
    expect(isScrollKey('a', null)).toBe(false)
    expect(isScrollKey('Enter', null)).toBe(false)
    expect(isScrollKey('Tab', null)).toBe(false)
  })

  it('ignores keys typed into a field', () => {
    expect(isScrollKey(' ', { tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(false)
    expect(isScrollKey('ArrowDown', { tagName: 'INPUT' } as unknown as EventTarget)).toBe(false)
    expect(isScrollKey(' ', { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(false)
    expect(isScrollKey(' ', { tagName: 'BODY' } as unknown as EventTarget)).toBe(true)
  })
})
