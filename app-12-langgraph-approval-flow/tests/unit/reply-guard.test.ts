import { describe, expect, it } from 'vitest'
import { fallbackBody } from '../../netlify/shared/nodes'
import { claimsPendingApproval } from '../../netlify/shared/reply-guard'

describe('claimsPendingApproval', () => {
  it.each([
    'Your refund requires approval from a member of our team before it can be processed.',
    'We will follow up once that approval is complete.',
    'The refund is pending review.',
    'Your request is awaiting approval.',
    'Approval is still required for this amount.',
    'A manager review is needed first.',
    'Once the review is complete, we will email you.',
    'We will follow up about the approval soon.',
    'The refund is subject to approval.',
  ])('flags a pending claim: %s', (text) => {
    expect(claimsPendingApproval(text)).toBe(true)
  })

  it.each([
    'A member of our team approved a refund of $100.00.',
    'Good news: your refund of $129.00 was approved by a member of our team.',
    'We reviewed your ticket and refunded the extra charge.',
    'No further approval is needed. The refund is on its way.',
    'This refund does not require approval.',
    // Written by the live model on the human-edit path, and wrongly flagged before the negation window grew.
    'This reflects the final decision made by our support team, and it is not subject to further review.',
    'The refund was issued without any further approval or delay.',
    'Thank you for contacting us. We are not able to refund this request.',
    'The refund should reach your card in 3 to 5 days. Reply to this email if you have questions.',
  ])('keeps a clean reply: %s', (text) => {
    expect(claimsPendingApproval(text)).toBe(false)
  })
})

describe('fallbackBody', () => {
  it('states the final outcome and never describes an approval as pending', () => {
    const bodies = [
      fallbackBody('refund', 100),
      fallbackBody('refund', 24.5, 'Within the automatic limit.'),
      fallbackBody('deny', 0),
      fallbackBody('deny', 0, 'Final sale orders cannot be refunded.'),
    ]
    for (const body of bodies) expect(claimsPendingApproval(body)).toBe(false)
    expect(bodies[0]).toBe('We have approved a refund of $100.00.')
    expect(bodies[3]).toContain('Final sale orders cannot be refunded.')
  })
})
