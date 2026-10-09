import { describe, expect, it } from 'vitest'
import { diffPlans } from '../../src/lib/planDiff'
import { EARTHQUAKE_VOCABULARY } from '../../src/lib/vocabulary'
import type { QueryPlan } from '../../src/types'

const BASE: QueryPlan = {
  chartType: 'bar',
  groupBy: 'region',
  aggregate: { field: 'id', fn: 'count' },
  sortBy: { field: 'id', dir: 'desc' },
  title: 'Earthquakes by region',
  explanation: '',
}

const texts = (next: QueryPlan, previous = BASE) => diffPlans(previous, next, EARTHQUAKE_VOCABULARY).map((change) => change.text)

describe('diffPlans', () => {
  it('says so when nothing the page shows has changed', () => {
    expect(diffPlans(BASE, { ...BASE, title: 'Another title' })).toEqual([{ kind: 'none', effect: 'same', text: 'Plan unchanged' }])
  })

  it('reports a filter that was added, in the dataset words', () => {
    expect(diffPlans(BASE, { ...BASE, filter: { field: 'region', op: 'eq', value: 'Alaska' } }, EARTHQUAKE_VOCABULARY)).toEqual([
      { kind: 'filter', effect: 'added', text: 'Filter added: region is Alaska' },
    ])
  })

  it('reports a second condition beside the first as one addition, not as a rewrite', () => {
    const before = { ...BASE, filter: { field: 'mag', op: 'gt' as const, value: '4' } }
    const after = { ...before, moreFilters: [{ field: 'region', op: 'eq' as const, value: 'Alaska' }] }
    expect(texts(after, before)).toEqual(['Filter added: region is Alaska'])
  })

  it('reads a condition on the same column with a new value as one change', () => {
    const before = { ...BASE, filter: { field: 'region', op: 'eq' as const, value: 'Alaska' } }
    const after = { ...BASE, filter: { field: 'region', op: 'eq' as const, value: 'Nevada' } }
    expect(texts(after, before)).toEqual(['Filter changed: region is Alaska to region is Nevada'])
  })

  it('reports a filter that was taken away', () => {
    const before = { ...BASE, filter: { field: 'mag', op: 'gte' as const, value: '5' } }
    expect(texts(BASE, before)).toEqual(['Filter removed: magnitude is at least 5'])
  })

  it('treats the same condition written in another case as unchanged', () => {
    const before = { ...BASE, filter: { field: 'region', op: 'eq' as const, value: 'Alaska' } }
    const after = { ...BASE, filter: { field: 'region', op: 'eq' as const, value: ' alaska' } }
    expect(texts(after, before)).toEqual(['Plan unchanged'])
  })

  it('reports the grouping, the chart and the measure', () => {
    expect(texts({ ...BASE, groupBy: 'magType' })).toEqual(['Grouped by magnitude type instead of region'])
    expect(texts({ ...BASE, chartType: 'line' })).toEqual(['Chart changed: bar to line'])
    expect(texts({ ...BASE, aggregate: { field: 'mag', fn: 'avg' }, sortBy: { field: 'mag', dir: 'desc' } })).toEqual(['Measure changed: number of earthquakes to average magnitude'])
  })

  it('reports a sort that flips and a sort that moves to the group names', () => {
    expect(texts({ ...BASE, sortBy: { field: 'id', dir: 'asc' } })).toEqual(['Sort changed: highest first to lowest first'])
    expect(texts({ ...BASE, sortBy: { field: 'region', dir: 'asc' } })).toEqual(['Sort changed: highest first to region A to Z'])
  })

  it('reports a threshold and a limit being added, changed and removed', () => {
    const limited = { ...BASE, limit: 5 }
    expect(texts(limited)).toEqual(['Limit added: top 5'])
    expect(texts({ ...limited, limit: 3 }, limited)).toEqual(['Limit changed: top 5 to top 3'])
    expect(texts(BASE, limited)).toEqual(['Limit removed: top 5'])
    expect(texts({ ...BASE, having: { op: 'gte', value: 10 } })).toEqual(['Threshold added: number of earthquakes at least 10'])
  })

  it('names the bottom end when the sort is ascending', () => {
    const asc = { ...BASE, sortBy: { field: 'id', dir: 'asc' as const } }
    expect(texts({ ...asc, limit: 3 }, asc)).toEqual(['Limit added: bottom 3'])
  })

  it('lists every change of a follow-up that did several things', () => {
    const next = { ...BASE, groupBy: 'magType', limit: 5, filter: { field: 'region', op: 'eq' as const, value: 'Alaska' } }
    expect(texts(next)).toEqual([
      'Filter added: region is Alaska',
      'Grouped by magnitude type instead of region',
      'Limit added: top 5',
    ])
  })
})

describe('diffPlans: implicit order', () => {
  it('does not report a sort change when only the chart type moved a plan with no sort between orders', () => {
    const plain = { ...BASE }
    delete plain.sortBy
    expect(diffPlans(plain, { ...plain, chartType: 'line' }).map((change) => change.text)).toEqual(['Chart changed: bar to line'])
  })
})
