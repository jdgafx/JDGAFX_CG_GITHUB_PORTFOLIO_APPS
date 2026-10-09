import { describe, expect, it } from 'vitest'
import { visibleError } from '../../src/lib/pickError'

describe('visibleError', () => {
  it('shows the message while the same number of slots is empty', () => {
    expect(visibleError({ message: 'Try again.', slotsLeft: 1 }, 1)).toBe('Try again.')
  })

  it('hides it once an image has arrived another way, and when there is no error', () => {
    expect(visibleError({ message: 'Try again.', slotsLeft: 1 }, 0)).toBe('')
    expect(visibleError({ message: 'Try again.', slotsLeft: 2 }, 1)).toBe('')
    expect(visibleError(null, 1)).toBe('')
  })
})
