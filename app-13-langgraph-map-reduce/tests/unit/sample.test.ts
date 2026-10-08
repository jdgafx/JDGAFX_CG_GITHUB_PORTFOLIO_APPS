import { describe, expect, it } from 'vitest'
import { MAX_CHARS, MIN_CHARS } from '../../src/lib/limits'
import { SAMPLE_TEXT, SAMPLE_TITLE } from '../../src/lib/sample'

describe('built-in sample', () => {
  it('fits the input limits, so the sample button always produces a valid run', () => {
    expect(SAMPLE_TEXT.length).toBeGreaterThanOrEqual(MIN_CHARS)
    expect(SAMPLE_TEXT.length).toBeLessThanOrEqual(MAX_CHARS)
    expect(SAMPLE_TITLE).toContain('Declaration')
  })

  it('carries the passages the expected summary depends on', () => {
    expect(SAMPLE_TEXT).toContain('certain unalienable Rights, that among these are Life, Liberty and the pursuit of Happiness.')
    expect(SAMPLE_TEXT).toContain('He has refused his Assent to Laws, the most wholesome and necessary for the public good.')
    expect(SAMPLE_TEXT).toContain('That these United Colonies are, and of Right ought to be Free and Independent States;')
    expect(SAMPLE_TEXT).toContain('Georgia: Button Gwinnett, Lyman Hall, George Walton.')
  })
})
