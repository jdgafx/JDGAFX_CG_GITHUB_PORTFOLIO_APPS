import { describe, expect, it } from 'vitest'
import { isLikelySilence, transcriptFromResults } from '../../src/lib/transcript'

describe('isLikelySilence', () => {
  it('treats empty text and stock silence phrases as no speech', () => {
    expect(isLikelySilence('')).toBe(true)
    expect(isLikelySilence('Thank you.')).toBe(true)
    expect(isLikelySilence('  Thanks!  ')).toBe(true)
    expect(isLikelySilence('Okay...')).toBe(true)
  })

  it('keeps real questions, even ones that start with a filler word', () => {
    expect(isLikelySilence('Open the calendar')).toBe(false)
    expect(isLikelySilence('Thank you for the calendar')).toBe(false)
    expect(isLikelySilence('Okay, what time is it')).toBe(false)
  })
})

describe('transcriptFromResults', () => {
  it('joins each recognised segment with a space', () => {
    expect(transcriptFromResults([[{ transcript: 'hello' }], [{ transcript: 'world' }]])).toBe('hello world')
  })

  it('rebuilds from the full result list, so a repeated event adds no duplicate words', () => {
    const firstEvent = [[{ transcript: 'hello' }]]
    const secondEvent = [[{ transcript: 'hello' }], [{ transcript: 'world' }]]

    expect(transcriptFromResults(firstEvent)).toBe('hello')
    expect(transcriptFromResults(secondEvent)).toBe('hello world')
  })

  it('skips blank segments and empty result entries', () => {
    expect(transcriptFromResults([[{ transcript: '   ' }], [], [{ transcript: 'hi' }]])).toBe('hi')
  })

  it('returns an empty string when nothing was recognised', () => {
    expect(transcriptFromResults([])).toBe('')
  })
})
