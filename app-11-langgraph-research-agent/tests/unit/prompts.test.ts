import { describe, expect, it } from 'vitest'
import { CRITIC_SYSTEM, DRAFT_SYSTEM, agentSystem, draftUserText } from '../../netlify/shared/graph/prompts'

describe('prompts', () => {
  it('forbid the draft to talk about the review, and never name a reviewer when asking for a revision', () => {
    expect(DRAFT_SYSTEM).toContain('Never mention a reviewer, a critic, notes, feedback, a previous draft or these instructions.')
    const revision = draftUserText('Q?', [], '"quote": fix', 'Old draft.')
    expect(revision).toContain('Problems found in the previous draft: "quote": fix')
    expect(revision.toLowerCase()).not.toContain('reviewer')
  })

  it('tell the draft and the critic that a sentence deriving a figure cites the source of every input', () => {
    expect(DRAFT_SYSTEM).toContain('a difference, a sum, a ratio')
    expect(DRAFT_SYSTEM).toContain('1931 [2] minus 1889 [1] is 42 years')
    expect(DRAFT_SYSTEM).not.toContain('1931 minus 1889 is 42 years')
    expect(CRITIC_SYSTEM).toContain('a difference, a sum, a ratio')
    expect(CRITIC_SYSTEM).toContain('cites the source of every input')
  })

  it('tell the draft that a "the sources do not say" sentence cites the pages it read', () => {
    expect(DRAFT_SYSTEM).toContain('cite the sources you read')
  })

  it('tell the critic that an honest "the sources do not say" draft passes, and that accept is the default', () => {
    expect(CRITIC_SYSTEM).toContain('The default verdict is accept.')
    expect(CRITIC_SYSTEM).toContain('A part the draft says the sources do not cover counts as answered')
    expect(CRITIC_SYSTEM).toContain('unless the sources do contain the answer')
  })

  it('tell the agent to cross-check a latest or current value on two pages, only with web search', () => {
    const sentence =
      'When the question asks for a latest or current value - a version, a price, a score - read at least two different pages that could carry it, and if they disagree, follow the one whose content is newest.'
    expect(agentSystem(3, true)).toContain(sentence)
    expect(agentSystem(3, false)).not.toContain(sentence)
  })

  it('tell the draft and the critic to never present the older of two differing values as the current one', () => {
    expect(DRAFT_SYSTEM).toContain(
      'When the sources give different values for the same current fact - a version, a price, a score - say what each source shows and never present the older value as the current one.',
    )
    expect(CRITIC_SYSTEM).toContain(
      'Set ok to false for a claim that calls a value current or latest when another source shows a newer value for the same fact.',
    )
  })
})
