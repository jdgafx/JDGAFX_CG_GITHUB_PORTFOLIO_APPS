import { describe, expect, it } from 'vitest'
import { sentenceCase } from '../../src/lib/titles'

describe('sentenceCase', () => {
  it('turns a Title Case chart title into sentence case', () => {
    expect(sentenceCase('Average Earthquake Magnitude by Magnitude Type')).toBe('Average earthquake magnitude by magnitude type')
    expect(sentenceCase('Total Precipitation by Month')).toBe('Total precipitation by month')
  })

  it('keeps acronyms, numbers and parenthesised words in order', () => {
    expect(sentenceCase('Top 5 Regions by Number of Earthquakes (Magnitude 2.5 and Above)')).toBe(
      'Top 5 regions by number of earthquakes (magnitude 2.5 and above)',
    )
    expect(sentenceCase('USGS Earthquakes by Region')).toBe('USGS earthquakes by region')
  })

  it('keeps the names of groups on the chart', () => {
    expect(sentenceCase('Earthquakes in Alaska by Magnitude Type', ['Alaska'])).toBe('Earthquakes in Alaska by magnitude type')
  })

  it('leaves a title that is already sentence case or a single word alone', () => {
    expect(sentenceCase('Total rain by month')).toBe('Total rain by month')
    expect(sentenceCase('Result')).toBe('Result')
  })
})
