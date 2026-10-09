import { describe, expect, it } from 'vitest'
import { visibleError } from '../../src/lib/pickError'

describe('visibleError', () => {
  it('shows the message while the same images are loaded', () => {
    expect(visibleError({ message: 'Try again.', loaded: 'blob:a|' }, 'blob:a|')).toBe('Try again.')
  })

  it('hides it when an image arrives into an empty slot', () => {
    expect(visibleError({ message: 'Try again.', loaded: '|' }, 'blob:a|')).toBe('')
  })

  it('hides it when an image is replaced while a slot was already filled (the slot count does not change)', () => {
    expect(visibleError({ message: 'Try again.', loaded: 'blob:a|' }, 'blob:b|')).toBe('')
    expect(visibleError({ message: 'Try again.', loaded: 'blob:a|blob:c' }, 'blob:a|blob:d')).toBe('')
  })

  it('shows nothing when there is no error', () => {
    expect(visibleError(null, 'blob:a|')).toBe('')
  })
})
