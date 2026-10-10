import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import ChartFrame from '../../src/components/ChartFrame'
import { chartSummary } from '../../src/lib/chartSummary'
import { executeQuery } from '../../src/lib/dataEngine'
import { parseEarthquakeCsv } from '../../src/lib/liveData/parse'
import { EARTHQUAKE_VOCABULARY } from '../../src/lib/vocabulary'
import { USGS_WEEK_EXCERPT } from '../fixtures/usgsWeek'
import type { AnalysisResult, QueryPlan } from '../../src/types'

const week = parseEarthquakeCsv(USGS_WEEK_EXCERPT)

const TOTAL: QueryPlan = {
  chartType: 'bar',
  groupBy: 'region',
  countColumn: 'rows',
  aggregate: { field: 'id', fn: 'count' },
  filter: { field: 'mag', op: 'gte', value: '4.5' },
  title: 'Earthquakes at magnitude 4.5 or greater',
  explanation: '',
}
const BY_REGION: QueryPlan = { ...TOTAL, countColumn: undefined, filter: undefined, title: 'Earthquakes by region', sortBy: { field: 'id', dir: 'desc' } }

const resultFor = (plan: QueryPlan): AnalysisResult => ({
  ...executeQuery(week, plan),
  queryPlan: plan,
  question: plan.title,
  dataset: 'Earthquakes, past 7 days',
  vocab: EARTHQUAKE_VOCABULARY,
})

// The bar list carries the chart summary as its aria-label. With no measured width the chart draws that list.
const summaryOf = (result: AnalysisResult) => {
  const html = renderToStaticMarkup(createElement(ChartFrame, { result }))
  const match = html.match(/<ul[^>]*aria-label="([^"]*)"/)
  if (!match) throw new Error('No bar list in the chart')
  return match[1]
}

describe('the chart summary', () => {
  it('states the one total for an overall plan, and never says across groups', () => {
    // 20 is the count of rows at magnitude 4.5 or more in the recorded text (the fixture's own tests count it too).
    expect(summaryOf(resultFor(TOTAL))).toBe('bar chart. number of earthquakes, all matching rows together: 20.')
  })

  it('states the group count and the largest group for a grouped plan', () => {
    // Nine regions in the 59 recorded rows; California holds 20 of them, counted from the raw place text.
    expect(summaryOf(resultFor(BY_REGION))).toBe('bar chart. number of earthquakes by region, across 9 groups. Largest: California at 20.')
  })

  it('builds the two sentences from the given parts', () => {
    expect(chartSummary({ chartType: 'bar', subject: 'Total rain', total: true, groups: 1, top: { label: 'All', value: '54 mm' } })).toBe(
      'bar chart. Total rain: 54 mm.',
    )
    expect(
      chartSummary({ chartType: 'bar', subject: 'Count by region', total: false, groups: 9, top: { label: 'Alaska', value: '14 earthquakes' } }),
    ).toBe('bar chart. Count by region, across 9 groups. Largest: Alaska at 14 earthquakes.')
  })
})

// The chart's heading, as the page prints it above the bars and in the CSV and PNG file names.
const titleOf = (result: AnalysisResult) => {
  const html = renderToStaticMarkup(createElement(ChartFrame, { result }))
  const match = html.match(/<div class="ds-chart__head"><b>([^<]*)<\/b>/)
  if (!match) throw new Error('No chart heading')
  return match[1]
}

describe('the chart title', () => {
  it('names no grouping on a total, though the model titled it "by region"', () => {
    // The model's title for a total on the live week feed was "Earthquakes with magnitude 4.5 or more, by region" over one bar.
    const title = titleOf(resultFor({ ...TOTAL, title: 'Earthquakes with Magnitude 4.5 or More, by Region' }))
    expect(title).toBe('Number of earthquakes where magnitude is at least 4.5')
    expect(title).not.toMatch(/by region/i)
  })

  it('keeps the place a total is filtered to as the data spells it', () => {
    const filtered: QueryPlan = {
      ...TOTAL,
      moreFilters: [{ field: 'region', op: 'eq', value: 'Alaska' }],
      title: 'Earthquakes with Magnitude 4.5 or More in Alaska',
    }
    expect(titleOf(resultFor(filtered))).toBe('Number of earthquakes where magnitude is at least 4.5 and region is Alaska')
  })

  it('keeps the place a grouped chart is filtered to, though the model wrote a Title Case title', () => {
    const grouped: QueryPlan = {
      ...BY_REGION,
      groupBy: 'magType',
      filter: { field: 'region', op: 'eq', value: 'California' },
      title: 'Earthquakes by Magnitude Type in California',
    }
    expect(titleOf(resultFor(grouped))).toBe('Earthquakes by magnitude type in California')
  })
})
