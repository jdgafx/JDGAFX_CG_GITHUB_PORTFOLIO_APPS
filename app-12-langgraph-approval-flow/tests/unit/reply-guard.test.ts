import { describe, expect, it } from 'vitest'
import { fallbackBody } from '../../netlify/shared/nodes'
import { claimsDetailsComplete, claimsPendingApproval, claimsUnearnedWork, contradictsLabels, draftProblem, hasForeignLink } from '../../netlify/shared/reply-guard'

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
    'Please do not treat this as a final decision on whether the behavior is acceptable.',
    'This is not a final decision.',
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
    "We've noted these facts on the issue.",
    'Your report is recorded above.',
    'The report has been logged under the compiler area.',
    'This issue was noted on our tracker.',
    'Your request is now recorded.',
    'I have noted this on the issue for the team.',
  ])('flags work the draft cannot claim: %s', (text) => {
    expect(claimsUnearnedWork(text)).toBe(true)
  })

  it.each([
    'This was noted in the docs.',
    'The error is logged to the console.',
    'The crash was recorded by the profiler.',
    'The area label was noted in the contributing guide.',
    'Thanks for the report.',
  ])('keeps a normal sentence that uses the same verbs: %s', (text) => {
    expect(claimsUnearnedWork(text)).toBe(false)
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

describe('contradictsLabels', () => {
  it('flags a type the final labels do not carry', () => {
    expect(contradictsLabels('We categorized this as a feature request.', ['question', 'needs-info'])).toBe(true)
    expect(contradictsLabels('It is now triaged as a bug.', ['enhancement'])).toBe(true)
    expect(contradictsLabels('This looks like a documentation issue.', ['bug'])).toBe(true)
    expect(contradictsLabels('We have labelled it as a question.', [])).toBe(true)
  })

  it('keeps a type the labels carry, and text that names no type', () => {
    expect(contradictsLabels('We categorized this as a feature request.', ['enhancement', 'area: cli'])).toBe(false)
    expect(contradictsLabels('It is now triaged as a bug.', ['bug'])).toBe(false)
    expect(contradictsLabels('Thanks for the report on the feature request template.', ['question'])).toBe(false)
    expect(contradictsLabels('Triaged with high priority.', [])).toBe(false)
  })
})

describe('claimsDetailsComplete', () => {
  it.each([
    'We have the details we need.',
    'We have all the information we need to look at this.',
    'There is enough detail in the report.',
    'No further information is needed.',
    'We do not need any more details.',
    'Your report is complete.',
  ])('flags, when needs-info is applied: %s', (text) => {
    expect(claimsDetailsComplete(text, ['bug', 'needs-info'])).toBe(true)
  })

  it('says nothing when needs-info is not applied, or when the draft asks for details', () => {
    expect(claimsDetailsComplete('We have the details we need.', ['bug'])).toBe(false)
    expect(claimsDetailsComplete('Please share the version and the steps to reproduce.', ['bug', 'needs-info'])).toBe(false)
    expect(claimsDetailsComplete('We need more detail to look into this.', ['needs-info'])).toBe(false)
  })
})

describe('draftProblem', () => {
  it('names the first problem and returns null for a clean draft', () => {
    expect(draftProblem('It is pending review.', 'acme/widgets', [])).toBe('said a decision or review was still pending')
    expect(draftProblem('We have fixed it.', 'acme/widgets', [])).toBe('claimed work that has not been done')
    expect(draftProblem('Go to https://evil.example.test', 'acme/widgets', [])).toBe('linked outside the issue repository')
    expect(draftProblem('We categorized this as a feature request.', 'acme/widgets', ['question'])).toBe(
      'named an issue type that the final labels do not have',
    )
    expect(draftProblem('We have the details we need.', 'acme/widgets', ['bug', 'needs-info'])).toBe(
      'said no more information is needed although the labels ask for more',
    )
    expect(draftProblem('Thanks for the report.', 'acme/widgets', ['bug'])).toBeNull()
  })
})

describe('fallbackBody', () => {
  it('states the final outcome and never describes anything as pending, claimed or linked', () => {
    const bodies = [
      fallbackBody({ outcome: 'auto', labels: ['question'], priority: 'low', note: null, action: 'label' as const, duplicateOf: null }),
      fallbackBody({ outcome: 'edited', labels: [], priority: 'high', note: 'x', action: 'label' as const, duplicateOf: null }),
      fallbackBody({ outcome: 'rejected', labels: [], priority: null, note: null, action: 'label' as const, duplicateOf: null }),
    ]
    for (const body of bodies) expect(draftProblem(body, 'acme/widgets', ['question'])).toBeNull()
    expect(bodies).toEqual([
      'Thank you for the report. This issue is now triaged as question with low priority.',
      'Thank you for the report. This issue is now triaged with high priority.',
      'Thank you for the report. A maintainer has looked at this issue.',
    ])
  })
})

describe('a draft for a duplicate', () => {
  it('must name the original issue by number, and #33 is not #334', () => {
    expect(draftProblem('This issue duplicates #334403. Please follow #334403.', 'acme/widgets', ['duplicate'], 334403)).toBeNull()
    expect(draftProblem('Thanks, we will look into it.', 'acme/widgets', ['duplicate'], 334403)).toBe('did not name the original issue #334403')
    expect(draftProblem('This is a duplicate of #3344031.', 'acme/widgets', ['duplicate'], 334403)).toBe('did not name the original issue #334403')
  })

  it('still rejects a claim that the issue was closed, since nothing is posted', () => {
    expect(draftProblem('We have closed this as a duplicate of #334403.', 'acme/widgets', ['duplicate'], 334403)).toBe('claimed work that has not been done')
  })

  it('does not ask for a number when the outcome is not a duplicate', () => {
    expect(draftProblem('Thanks for the report.', 'acme/widgets', ['question'])).toBeNull()
  })
})
