import { describe, expect, it } from 'vitest'
import { chartTitle, sentenceCase, titleNames } from '../../src/lib/titles'
import { EARTHQUAKE_VOCABULARY } from '../../src/lib/vocabulary'
import type { QueryPlan } from '../../src/types'

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

describe('sentenceCase: mixed-case names and short titles', () => {
  it('keeps a mixed-case token such as mRNA or iPhone as written', () => {
    expect(sentenceCase('How mRNA Vaccines Work')).toBe('How mRNA vaccines work')
    expect(sentenceCase('Why the iPhone Changed Phones')).toBe('Why the iPhone changed phones')
  })

  it('lowers a title with one long word when every other word is capitalised', () => {
    expect(sentenceCase('The Mechanism')).toBe('The mechanism')
    expect(sentenceCase('Key Findings')).toBe('Key findings')
    expect(sentenceCase('The Event')).toBe('The event')
  })

  it('leaves a short title alone when another word is lower case', () => {
    expect(sentenceCase('Rain in the city')).toBe('Rain in the city')
    expect(sentenceCase('Total rain')).toBe('Total rain')
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

describe('chartTitle on a total and on a filtered chart', () => {
  it('uses what the plan computes for a total, never the model words "by region"', () => {
    // The title the model wrote for a total on 2026-10-10 ("1 group" on the chart), with the title the plan describes.
    const total = { title: 'Earthquakes with Magnitude 4.5 or More, by Region', groupBy: 'region', countColumn: 'rows' }
    expect(chartTitle({ queryPlan: total }, 'number of earthquakes where magnitude is at least 4.5')).toBe(
      'Number of earthquakes where magnitude is at least 4.5',
    )
  })

  it('keeps the model title for a grouped plan, and a stand-in title for a total that stands in', () => {
    const grouped = { title: 'Earthquakes by Region', groupBy: 'region', countColumn: 'region' }
    expect(chartTitle({ queryPlan: grouped }, 'x')).toBe('Earthquakes by region')
    const standIn = { title: 'T', groupBy: 'region', countColumn: 'rows', missing: ['aftershocks'] }
    expect(chartTitle({ queryPlan: standIn }, 'number of earthquakes')).toBe('Number of earthquakes (stand-in for aftershocks)')
  })

  it('keeps the places a result names, the groups drawn and the values the plan filters on, whatever case the model used', () => {
    const plan: QueryPlan = {
      chartType: 'bar',
      groupBy: 'region',
      aggregate: { field: 'id', fn: 'count' },
      filter: { field: 'region', op: 'eq', value: 'Alaska' },
      title: 'Earthquakes with Magnitude 4.5 or More in Alaska',
      explanation: '',
    }
    const names = titleNames(plan, ['Texas'], EARTHQUAKE_VOCABULARY)
    expect(names).toEqual(expect.arrayContaining(['Alaska', 'Texas']))
    expect(chartTitle({ queryPlan: plan }, 'x', names)).toBe('Earthquakes with magnitude 4.5 or more in Alaska')
    // With the filter's value left out of the names, the place is lowered with the other Title Case words.
    const grouped = titleNames({ ...plan, filter: undefined }, ['Texas'], EARTHQUAKE_VOCABULARY)
    expect(chartTitle({ queryPlan: plan }, 'x', grouped)).toBe('Earthquakes with magnitude 4.5 or more in alaska')
  })
})
