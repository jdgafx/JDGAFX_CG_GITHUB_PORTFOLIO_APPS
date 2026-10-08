import { type ComponentType, createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Bar, BarChart, Line, LineChart, XAxis, YAxis } from 'recharts'
import { describe, expect, it } from 'vitest'
import { CHART_KEYS, CHART_MOTION, toDailyPoints, toFeaturePoints } from '../../src/lib/chartData'
import { mockDailyUsage, mockFeatureUsage, WINDOW_DAYS } from '../../src/lib/mockData'

const daily = toDailyPoints(mockDailyUsage)
const features = toFeaturePoints(mockFeatureUsage)

/**
 * Recharts' class typings do not match createElement's overloads, so every chart and series in these tests is
 * built through this one helper, with the same props the components pass.
 */
const el = (component: unknown, props: Record<string, unknown>, ...children: ReactNode[]) =>
  createElement(component as ComponentType<Record<string, unknown>>, props, ...children)

describe('daily chart points', () => {
  it('has one point for each of the 30 days in the window', () => {
    expect(daily).toHaveLength(30)
    expect(daily).toHaveLength(WINDOW_DAYS)
  })

  it('has the date, calls and errorRate keys, each with a usable value', () => {
    for (const point of daily) {
      expect(Object.keys(point).sort()).toEqual([CHART_KEYS.calls, CHART_KEYS.date, CHART_KEYS.errorRate].sort())
      expect(point.date).toMatch(/^\d{2}-\d{2}$/)
      expect(Number.isFinite(point.calls)).toBe(true)
      expect(Number.isFinite(point.errorRate)).toBe(true)
    }
  })

  it('copies each value from its source day, in order', () => {
    daily.forEach((point, i) => {
      expect(point.date).toBe(mockDailyUsage[i].date.slice(5))
      expect(point.calls).toBe(mockDailyUsage[i].api_calls)
      expect(point.errorRate).toBe(mockDailyUsage[i].error_rate)
    })
  })
})

describe('feature chart points', () => {
  it('has one row per feature, with the feature and calls keys', () => {
    expect(features.length).toBeGreaterThan(0)
    expect(features).toHaveLength(mockFeatureUsage.length)
    for (const row of features) {
      expect(Object.keys(row).sort()).toEqual([CHART_KEYS.calls, CHART_KEYS.feature].sort())
      expect(typeof row.feature).toBe('string')
      expect(Number.isFinite(row.calls)).toBe(true)
    }
  })
})

describe('series draw from the shaped data on the first render', () => {
  it('draws the daily calls and error-rate lines in full, with no dash left from an animation', () => {
    for (const dataKey of [CHART_KEYS.calls, CHART_KEYS.errorRate]) {
      const markup = renderToStaticMarkup(
        el(LineChart, { width: 600, height: 220, data: daily }, el(Line, { dataKey, dot: false, ...CHART_MOTION })),
      )
      expect(markup).toMatch(/recharts-line-curve" d="M[-\d.]+,[-\d.]+L/)
      expect(markup).not.toContain('stroke-dasharray')
    }
  })

  it('draws one bar per feature', () => {
    const markup = renderToStaticMarkup(
      el(
        BarChart,
        { width: 600, height: 220, data: features, layout: 'vertical' },
        el(XAxis, { type: 'number' }),
        el(YAxis, { type: 'category', dataKey: CHART_KEYS.feature }),
        el(Bar, { dataKey: CHART_KEYS.calls, ...CHART_MOTION }),
      ),
    )
    expect(markup.match(/class="recharts-rectangle"/g)).toHaveLength(features.length)
  })
})
