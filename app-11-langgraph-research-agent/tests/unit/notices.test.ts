import { describe, expect, it } from 'vitest'
import { answerNotice, TRUNCATED_NOTICE } from '../../src/lib/notices'

describe('answerNotice', () => {
  it('shows the cut-short notice when the answer hit its length limit', () => {
    expect(answerNotice({ truncated: true })).toBe('The answer was cut short at its length limit.')
    expect(TRUNCATED_NOTICE).toBe('The answer was cut short at its length limit.')
  })

  it('shows nothing for a complete answer', () => {
    expect(answerNotice({ truncated: false })).toBeNull()
  })
})
