import { describe, expect, it } from 'vitest'
import {
  MAX_STAGE_TEXT_CHARS, STAGE_INPUTS, buildSystemPrompt, buildUserMessage, rejectOutput, wordCount,
} from '../../netlify/shared/stages'

const TOPIC = 'Why unit tests matter for small teams'
const ARTICLE = 'Unit tests give a small team fast feedback. '.repeat(20)
const LABEL = 'The AI provider answered with a safety label instead of text, so this stage was discarded.'

// Text of exactly `count` words.
function words(count: number): string {
  return Array.from({ length: count }, () => 'word').join(' ')
}

function reply(content: string, finishReason: string | null = 'stop', servedModel: string | null = 'anthropic/claude-haiku-4.5') {
  return { content, finishReason, servedModel }
}

describe('buildUserMessage', () => {
  it('asks for the first stage from the topic alone', () => {
    expect(buildUserMessage('research', TOPIC, 'Blog Post', {})).toBe(`Create a Blog Post about: ${TOPIC}`)
  })

  it('passes the research and the outline into the draft, in that order', () => {
    const message = buildUserMessage('draft', TOPIC, 'Blog Post', { research: 'Fact one.', outline: '- Point' })
    expect(message).toBe(
      `## Research\nFact one.\n\n## Outline\n- Point\n\nUsing the material above, draft the Blog Post about: ${TOPIC}`,
    )
  })

  it('clips a prior stage to 1,800 characters before it reaches the prompt', () => {
    const message = buildUserMessage('outline', TOPIC, 'Blog Post', { research: 'x'.repeat(2_000) })
    expect(message).toContain(`${'x'.repeat(1_800)}\n...[truncated]`)
    expect(message).not.toContain('x'.repeat(1_801))
  })
})

describe('buildSystemPrompt', () => {
  it('names the step and its word budget for each stage', () => {
    expect(buildSystemPrompt('research', TOPIC, 'Blog Post')).toContain('Current step: RESEARCH.')
    expect(buildSystemPrompt('research', TOPIC, 'Blog Post')).toContain('roughly 80 words')
    expect(buildSystemPrompt('outline', TOPIC, 'Blog Post')).toContain('roughly 100 words')
    expect(buildSystemPrompt('draft', TOPIC, 'Blog Post')).toContain('roughly 160 words')
    expect(buildSystemPrompt('edit', TOPIC, 'Blog Post')).toContain('roughly 160 words')
    expect(buildSystemPrompt('polish', TOPIC, 'Blog Post')).toContain('Current step: POLISH.')
  })

  it('states the content type and the topic', () => {
    expect(buildSystemPrompt('draft', TOPIC, 'Newsletter')).toContain(`a Newsletter about: "${TOPIC}"`)
  })

  it('tells polish to keep the edited text and not make it longer', () => {
    expect(buildSystemPrompt('polish', TOPIC, 'Blog Post')).toContain('do not make it longer')
  })
})

describe('rejectOutput: text that is not an article', () => {
  it('accepts a normal article for every stage', () => {
    expect(rejectOutput('draft', reply(ARTICLE), { research: 'r', outline: 'o' })).toBeNull()
  })

  it('rejects a moderation label whatever model served it', () => {
    expect(rejectOutput('polish', reply('User Safety: safe'), { edit: ARTICLE })).toEqual({ message: LABEL, retryable: false })
    expect(rejectOutput('draft', reply('User Safety: unsafe.'), { research: 'r', outline: 'o' })).toEqual({ message: LABEL, retryable: false })
    expect(rejectOutput('research', reply('Unsafe'), {})).toEqual({ message: LABEL, retryable: false })
  })

  it('rejects a reply from a content-safety model even when its text looks like an article', () => {
    const served = { ...reply(ARTICLE), servedModel: 'nvidia/nemotron-3.5-content-safety:free' }
    expect(rejectOutput('draft', served, { research: 'r', outline: 'o' })).toEqual({ message: LABEL, retryable: false })
  })

  it('does not mistake a long article that mentions a safety rating for a label', () => {
    const article = `${ARTICLE} Memory safety: safe defaults matter.`
    expect(rejectOutput('draft', reply(article), { research: 'r', outline: 'o' })).toBeNull()
  })

  it('rejects an empty reply and allows one retry', () => {
    expect(rejectOutput('research', reply('   '), {})).toEqual({
      message: 'The AI provider returned no text for this stage.',
      retryable: true,
    })
  })

  it('rejects a reply cut off by the token limit and allows one retry', () => {
    expect(rejectOutput('draft', reply(ARTICLE, 'length'), { research: 'r', outline: 'o' })).toEqual({
      message: 'This stage ran out of room before it finished.',
      retryable: true,
    })
  })

  it('rejects a reply of fewer than five words', () => {
    expect(rejectOutput('research', reply('Only four words here'), {})).toEqual({
      message: 'This stage returned too little text to use.',
      retryable: true,
    })
  })

  it('refuses output too long for the next stage to accept, without a retry', () => {
    expect(rejectOutput('draft', reply(words(2_000)), { research: 'r', outline: 'o' })).toEqual({
      message: 'This stage wrote more text than the next stage can take, so it was discarded.',
      retryable: false,
    })
    expect(rejectOutput('draft', reply(words(1_500)), { research: 'r', outline: 'o' })).toBeNull()
  })
})

describe('rejectOutput: Edit and Polish keep the length of their input', () => {
  it('rejects an Edit under half the words of the Draft, and accepts exactly half', () => {
    const draft = { outline: 'o', draft: words(100) }
    expect(rejectOutput('edit', reply(words(49)), draft)).toEqual({
      message: 'This stage returned far less text than the Draft stage it was given, so it was discarded.',
      retryable: true,
    })
    expect(rejectOutput('edit', reply(words(50)), draft)).toBeNull()
  })

  it('rejects a Polish under half the words of the Edit, and accepts exactly half', () => {
    expect(rejectOutput('polish', reply(words(30)), { edit: words(100) })).toEqual({
      message: 'This stage returned far less text than the Edit stage it was given, so it was discarded.',
      retryable: true,
    })
    expect(rejectOutput('polish', reply(words(60)), { edit: words(100) })).toBeNull()
  })
})

describe('stage constants', () => {
  it('gives polish the edit as its only input and edit the outline and the draft', () => {
    expect(STAGE_INPUTS.polish).toEqual(['edit'])
    expect(STAGE_INPUTS.edit).toEqual(['outline', 'draft'])
  })

  it('caps a stage output at 8,000 characters', () => {
    expect(MAX_STAGE_TEXT_CHARS).toBe(8_000)
  })

  it('counts words without counting the spaces around them', () => {
    expect(wordCount('  one two\nthree ')).toBe(3)
    expect(wordCount('   ')).toBe(0)
  })
})
