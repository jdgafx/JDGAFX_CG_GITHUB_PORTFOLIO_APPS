import { describe, expect, it } from 'vitest'
import { reasonsWithoutDuplicate } from '../../src/lib/reasons'

describe('reasonsWithoutDuplicate', () => {
  it('drops the duplicate reason the proposed action already shows, and keeps the others in order', () => {
    const reasons = [
      'It looks like a duplicate of #334403 (Compact menu bar button). Both report the same menu failure.',
      'It may duplicate an existing issue.',
      'It is a bug of medium severity.',
    ]
    expect(reasonsWithoutDuplicate(reasons)).toEqual(['It may duplicate an existing issue.', 'It is a bug of medium severity.'])
  })

  it('leaves a list without one unchanged', () => {
    expect(reasonsWithoutDuplicate(['The report is unclear or missing details.'])).toEqual(['The report is unclear or missing details.'])
  })
})
