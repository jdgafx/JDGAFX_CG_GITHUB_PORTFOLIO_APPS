import { describe, expect, it } from 'vitest'
import { MAX_CODE_LENGTH, OVER_LIMIT_MESSAGE } from '../../src/lib/limits'

describe('code length limit', () => {
  it('allows up to 50,000 characters and names that limit in the message', () => {
    expect(MAX_CODE_LENGTH).toBe(50000)
    expect(OVER_LIMIT_MESSAGE).toBe('Code exceeds the 50,000 character limit')
  })
})
