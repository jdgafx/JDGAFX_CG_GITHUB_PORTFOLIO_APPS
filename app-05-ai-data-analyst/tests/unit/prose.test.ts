import { describe, expect, it } from 'vitest'
import { plainText } from '../../src/lib/prose'

describe('plainText', () => {
  it('drops the markers and keeps the words', () => {
    expect(plainText('The data has **no** column for `wind`, so *rain* is shown.')).toBe(
      'The data has no column for wind, so rain is shown.',
    )
  })

  it('leaves a lone asterisk, a citation and plain text alone', () => {
    expect(plainText('5 * 3 and [1]')).toBe('5 * 3 and [1]')
  })

  it('never turns markup into elements: it stays text', () => {
    expect(plainText('<b>x</b> **y**')).toBe('<b>x</b> y')
  })
})
