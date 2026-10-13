import { describe, expect, it } from 'vitest'
import { isScrollKey, scrollBehavior, shouldBringIntoView } from '../../src/replay'

describe('shouldBringIntoView', () => {
  it('scrolls only on a narrow screen and only when the visitor did not scroll', () => {
    expect(shouldBringIntoView(true, false)).toBe(true)
    expect(shouldBringIntoView(true, true)).toBe(false)
    expect(shouldBringIntoView(false, false)).toBe(false)
    expect(shouldBringIntoView(false, true)).toBe(false)
  })
})

describe('scrollBehavior', () => {
  it('glides only on a visible page without reduced motion', () => {
    expect(scrollBehavior(false, true)).toBe('smooth')
  })

  it('jumps when motion is reduced, and when the page is not painting', () => {
    expect(scrollBehavior(true, true)).toBe('auto')
    expect(scrollBehavior(false, false)).toBe('auto')
    expect(scrollBehavior(true, false)).toBe('auto')
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
