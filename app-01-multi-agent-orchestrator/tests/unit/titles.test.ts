import { describe, expect, it } from 'vitest'
import { chartTitle, sentenceCase } from '../../src/lib/titles'

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

describe('sentenceCase: units and small words', () => {
  it('keeps a unit such as °C as written', () => {
    expect(sentenceCase('Count of Days Above 20 °C by Month')).toBe('Count of days above 20 °C by month')
    expect(sentenceCase('Hottest Days (Days Above 20 °C)')).toBe('Hottest days (days above 20 °C)')
  })

  it('treats a Title Case title with a small lowercase word as Title Case', () => {
    expect(sentenceCase('Average Magnitude with Depth Over 10 km by Region')).toBe(
      'Average magnitude with depth over 10 km by region',
    )
  })
})

describe('sentenceCase: the live titles', () => {
  it('handles the title the model wrote for a threshold on the daily high', () => {
    expect(sentenceCase('Average Daily High Temperature by Month (Days Above 20 °C)')).toBe(
      'Average daily high temperature by month (days above 20 °C)',
    )
  })
})

describe('chartTitle', () => {
  const plan = { title: 'Average Wind Speed by Month', groupBy: 'month' }

  it('uses the model title in sentence case for an ordinary chart', () => {
    expect(chartTitle({ queryPlan: plan }, 'average daily high temperature by month')).toBe('Average wind speed by month')
  })

  it('names what a stand-in chart plots and what it stands in for', () => {
    expect(chartTitle({ queryPlan: { ...plan, missing: ['wind speed'] } }, 'average daily high temperature by month')).toBe(
      'Average daily high temperature by month (stand-in for wind speed)',
    )
  })

  it('ignores an empty missing list', () => {
    expect(chartTitle({ queryPlan: { ...plan, missing: [] } }, 'x by month')).toBe('Average wind speed by month')
  })
})
