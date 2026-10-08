import { describe, expect, it } from 'vitest'
import { PlainError, plainMessageOf } from '../../netlify/shared/errors'

describe('plainMessageOf', () => {
  it('returns the message of a plain error', () => {
    expect(plainMessageOf(new PlainError(502, 'The AI provider did not answer in time.'))).toBe(
      'The AI provider did not answer in time.',
    )
  })

  it('looks through an AggregateError to the plain error inside it', () => {
    const wrapped = new AggregateError(
      [new TypeError('socket hang up'), new PlainError(402, 'The AI provider rejected the key or is out of credit.')],
      'wrapper',
    )
    expect(plainMessageOf(wrapped)).toBe('The AI provider rejected the key or is out of credit.')
  })

  it('looks through a cause chain', () => {
    const outer = new Error('wrapper', { cause: new PlainError(429, 'Rate limited, try again in a minute.') })
    expect(plainMessageOf(outer)).toBe('Rate limited, try again in a minute.')
  })

  it('returns null when there is no plain message, so internal text never reaches a visitor', () => {
    expect(plainMessageOf(new AggregateError([new Error('internal detail')], 'wrapper'))).toBeNull()
    expect(plainMessageOf(new Error('internal detail'))).toBeNull()
    expect(plainMessageOf('a bare string')).toBeNull()
  })
})
