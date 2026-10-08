import { describe, expect, it } from 'vitest'
import {
  absorb,
  newState,
  providerMessage,
  readUsage,
  validate,
  type ReadState,
} from '../../netlify/shared/upstream'

const NO_ANALYSIS = 'The vision service returned no usable analysis. Please retry with the same image.'

function line(value: unknown): string {
  return `data: ${JSON.stringify(value)}`
}

function absorbAll(lines: string[]): { state: ReadState; frames: Record<string, unknown>[] } {
  const state = newState()
  const frames: Record<string, unknown>[] = []
  for (const text of lines) absorb(text, state, frame => frames.push(frame))
  return { state, frames }
}

function stateWith(overrides: Partial<ReadState>): ReadState {
  return { ...newState(), ...overrides }
}

describe('absorb', () => {
  it('emits each text delta in order and records the served model', () => {
    const { state, frames } = absorbAll([
      line({ model: 'anthropic/claude-haiku-4.5', choices: [{ delta: { content: 'HELLO' } }] }),
      line({ choices: [{ delta: { content: ' 42' } }] }),
    ])
    expect(frames).toEqual([{ text: 'HELLO' }, { text: ' 42' }])
    expect(state.text).toBe('HELLO 42')
    expect(state.chunks).toBe(2)
    expect(state.served).toBe('anthropic/claude-haiku-4.5')
  })

  it('reads token usage, cost and the finish reason from the final chunk', () => {
    const { state } = absorbAll([
      line({
        choices: [{ finish_reason: 'stop', delta: {} }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 },
      }),
    ])
    expect(state.usage).toEqual({ prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 })
    expect(state.finishReason).toBe('stop')
  })

  it('leaves cost undefined when the provider sends it as something other than a number', () => {
    const { state } = absorbAll([line({ usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, cost: '0.1' } })])
    expect(state.usage?.total_tokens).toBe(7)
    expect(state.usage?.cost).toBeUndefined()
  })

  it('blocks a moderation reply before any of its text is emitted', () => {
    const { state, frames } = absorbAll([
      line({ model: 'openai/content-safety-guard', choices: [{ delta: { content: 'Safe' } }] }),
    ])
    expect(state.moderated).toBe(true)
    expect(state.text).toBe('')
    expect(frames).toEqual([])
  })

  it('flags a provider error frame without emitting text', () => {
    const { state, frames } = absorbAll([line({ error: { code: 402, message: 'insufficient credits' } })])
    expect(state.providerError).toBe(true)
    expect(frames).toEqual([])
  })

  it('ignores keep-alive lines, done markers and malformed JSON', () => {
    const { state, frames } = absorbAll([': keep-alive', 'data: [DONE]', 'data: {not json', 'data: ', 'event: ping'])
    expect(frames).toEqual([])
    expect(state.chunks).toBe(0)
    expect(state.served).toBeNull()
  })
})

describe('readUsage', () => {
  it('keeps only numeric counts', () => {
    expect(readUsage({ prompt_tokens: 'many', completion_tokens: 3, total_tokens: 3, cost: null })).toEqual({
      prompt_tokens: undefined,
      completion_tokens: 3,
      total_tokens: 3,
      cost: undefined,
    })
  })
})

describe('validate', () => {
  it('accepts a non-empty reply that finished normally', () => {
    expect(validate(stateWith({ text: 'A red sign.', finishReason: 'stop' }))).toBeNull()
  })

  it('reports a reply cut off by the token limit as truncated', () => {
    expect(validate(stateWith({ text: 'The sign', finishReason: 'length' }))).toEqual({
      detail: 'Output reached the token limit before the analysis finished',
      message: 'The vision service stopped before the analysis finished. Please retry with the same image.',
      truncated: true,
    })
  })

  it('rejects a content-filtered reply and a blank reply', () => {
    expect(validate(stateWith({ text: 'x', finishReason: 'content_filter' }))).toEqual({
      detail: 'The provider filtered this output',
      message: NO_ANALYSIS,
      truncated: false,
    })
    expect(validate(stateWith({ text: '   ', finishReason: 'stop' }))).toEqual({
      detail: 'No text was returned',
      message: NO_ANALYSIS,
      truncated: false,
    })
  })
})

describe('providerMessage', () => {
  it.each([
    [401, 'The AI provider rejected the key or is out of credit.'],
    [402, 'The AI provider rejected the key or is out of credit.'],
    [403, 'The AI provider rejected the key or is out of credit.'],
    [429, 'Rate limited, try again in a minute.'],
    [500, 'The AI provider did not answer in time.'],
    [503, 'The AI provider did not answer in time.'],
    [400, 'The AI provider could not process this image.'],
  ])('maps HTTP %i to plain words', (status, message) => {
    expect(providerMessage(status)).toBe(message)
  })
})
