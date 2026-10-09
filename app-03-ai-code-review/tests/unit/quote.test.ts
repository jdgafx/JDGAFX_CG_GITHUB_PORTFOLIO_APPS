import { describe, expect, it } from 'vitest'
import { quoteRange, splitAtQuote } from '../../src/lib/quote'

describe('quoteRange and splitAtQuote', () => {
  // A live second-pass quote and the line it came from (mux.go v1.8.1, line 527).
  const line = '\t\tregex, err := regexp.Compile(pairs[i+1])'

  it('finds the quote and splits the line around it', () => {
    expect(splitAtQuote(line, 'regexp.Compile(pairs[i+1])')).toEqual({ before: '\t\tregex, err := ', quote: 'regexp.Compile(pairs[i+1])', after: '' })
  })

  it('ignores differences in spacing, as the server check does', () => {
    expect(splitAtQuote(line, 'regex,  err :=   regexp.Compile')).toMatchObject({ before: '\t\t', quote: 'regex, err := regexp.Compile', after: '(pairs[i+1])' })
  })

  it('reads a quote that kept a line-number prefix or a diff sign', () => {
    expect(quoteRange('+\tloc = os.path.expanduser(f)', '+ loc = os.path.expanduser(f)')).toEqual([0, 29])
    expect(splitAtQuote('foo := bar()', '12\t| foo := bar()')?.quote).toBe('foo := bar()')
  })

  it('gives null for no quote, a short one, or one that is on another line', () => {
    expect(quoteRange(line, null)).toBeNull()
    expect(quoteRange(line, '}')).toBeNull()
    expect(quoteRange(line, 'defer mu.Unlock()')).toBeNull()
  })
})
