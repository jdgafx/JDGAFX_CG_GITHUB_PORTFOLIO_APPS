import { describe, expect, it } from 'vitest'
import { dedent, markSegments, quoteRange, splitAtQuote } from '../../src/lib/quote'

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

describe('dedent', () => {
  // click 8.1.7 LazyFile.open, lines 153 to 159: every line shares 8 spaces, and the body is indented further.
  const block = [
    '        if self._f is not None:',
    '            return self._f',
    '        try:',
    '            rv, self.should_close = open_stream(self.name)',
    '        except OSError as e:',
  ]

  it('removes only the indent the lines share, so the block keeps its structure', () => {
    expect(dedent(block)).toEqual(['if self._f is not None:', '    return self._f', 'try:', '    rv, self.should_close = open_stream(self.name)', 'except OSError as e:'])
  })

  it('ignores blank lines when finding the shared indent, and handles tabs', () => {
    expect(dedent(['\t\tfoo', '', '\t\t\tbar'])).toEqual(['foo', '', '\tbar'])
    expect(dedent(['    ', '  x'])).toEqual(['', 'x'])
  })

  it('leaves a single line without indent and an all-blank block alone', () => {
    expect(dedent(['    return iter(self._f)'])).toEqual(['return iter(self._f)'])
    expect(dedent(['', ''])).toEqual(['', ''])
  })
})

describe('markSegments', () => {
  const line = 'regex, err := regexp.Compile(pairs[i+1])'

  it('marks the evidence, and marks the support too when it is a different part of the same line', () => {
    expect(markSegments(line, 'regexp.Compile(pairs[i+1])', 'regex, err :=')).toEqual([
      { text: 'regex, err :=', mark: 'support' },
      { text: ' ', mark: null },
      { text: 'regexp.Compile(pairs[i+1])', mark: 'evidence' },
    ])
  })

  it('uses one evidence mark when the support is the same code or overlaps it', () => {
    expect(markSegments(line, 'regexp.Compile(pairs[i+1])', 'regexp.Compile(pairs[i+1])')).toEqual([{ text: 'regex, err := ', mark: null }, { text: 'regexp.Compile(pairs[i+1])', mark: 'evidence' }])
  })

  it('gives null when neither quote is on the line', () => {
    expect(markSegments(line, 'defer mu.Unlock()', null)).toBeNull()
  })
})
