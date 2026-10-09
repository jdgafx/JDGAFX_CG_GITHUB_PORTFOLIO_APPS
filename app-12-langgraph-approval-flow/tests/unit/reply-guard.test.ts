import { describe, expect, it } from 'vitest'
import { fallbackBody } from '../../netlify/shared/nodes'
import { claimsPendingApproval, claimsUnearnedWork, draftProblem, hasForeignLink } from '../../netlify/shared/reply-guard'

describe('claimsPendingApproval', () => {
  it.each([
    'This issue requires review from a maintainer before it can be triaged.',
    'We will follow up once that review is complete.',
    'Triage is pending.',
    'Your report is awaiting review.',
    'Approval is still required for this label.',
    'A maintainer review is needed first.',
    'Once the review is complete, we will label it.',
    'We will follow up about the review soon.',
    'The label is subject to approval.',
  ])('flags a pending claim: %s', (text) => {
    expect(claimsPendingApproval(text)).toBe(true)
  })

  it.each([
    'A maintainer approved the labels and set high priority.',
    'Thanks for the report. We reviewed it and labelled it as a bug.',
    'No further review is needed. The issue is triaged as a question.',
    'This label does not require approval.',
    'This is the final decision made by the maintainers, and it is not subject to further review.',
    'The label was applied without any further approval or delay.',
    'Thank you for the report. A maintainer has looked at this issue.',
    'Thanks! Please add your version number and the steps to reproduce so we can look into it.',
  ])('keeps a clean draft: %s', (text) => {
    expect(claimsPendingApproval(text)).toBe(false)
  })
})

describe('claimsUnearnedWork', () => {
  it.each([
    'We have fixed this in the latest release.',
    "I've merged a patch for it.",
    'This has been resolved.',
    'It is fixed in v2.1.',
    'We already closed the duplicate.',
  ])('flags work the draft cannot claim: %s', (text) => {
    expect(claimsUnearnedWork(text)).toBe(true)
  })

  it.each(['Thanks for the report.', 'A fix would need a minimal reproduction.', 'Please confirm whether the problem still happens.'])(
    'keeps: %s',
    (text) => {
      expect(claimsUnearnedWork(text)).toBe(false)
    },
  )
})

describe('hasForeignLink', () => {
  it('allows links into the issue repository and nothing else', () => {
    expect(hasForeignLink('See https://github.com/acme/widgets/issues/5 and https://github.com/acme/widgets.', 'acme/widgets')).toBe(false)
    expect(hasForeignLink('See https://github.com/acme/widgets-evil/issues/5', 'acme/widgets')).toBe(true)
    expect(hasForeignLink('Visit https://evil.example.test/x', 'acme/widgets')).toBe(true)
    expect(hasForeignLink('Visit www.evil.example.test', 'acme/widgets')).toBe(true)
    expect(hasForeignLink('No links here.', 'acme/widgets')).toBe(false)
  })
})

describe('draftProblem', () => {
  it('names the first problem and returns null for a clean draft', () => {
    expect(draftProblem('It is pending review.', 'acme/widgets')).toBe('said a decision or review was still pending')
    expect(draftProblem('We have fixed it.', 'acme/widgets')).toBe('claimed work that has not been done')
    expect(draftProblem('Go to https://evil.example.test', 'acme/widgets')).toBe('linked outside the issue repository')
    expect(draftProblem('Thanks for the report.', 'acme/widgets')).toBeNull()
  })
})

describe('fallbackBody', () => {
  it('states the final outcome and never describes anything as pending, claimed or linked', () => {
    const bodies = [
      fallbackBody({ outcome: 'auto', labels: ['question'], priority: 'low', note: null }),
      fallbackBody({ outcome: 'edited', labels: [], priority: 'high', note: 'x' }),
      fallbackBody({ outcome: 'rejected', labels: [], priority: null, note: null }),
    ]
    for (const body of bodies) expect(draftProblem(body, 'acme/widgets')).toBeNull()
    expect(bodies).toEqual([
      'Thank you for the report. This issue is now triaged as question with low priority.',
      'Thank you for the report. This issue is now triaged with high priority.',
      'Thank you for the report. A maintainer has looked at this issue.',
    ])
  })
})
