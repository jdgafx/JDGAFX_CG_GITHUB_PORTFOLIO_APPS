import { describe, expect, it } from 'vitest'
import { arcPath, formatTick, isTimeAxis, limitGroups, lineNeedsOrder, niceTicks, pieIsCrowded, scaleLinear, thinIndexes, tickPlacement, truncateLabel } from '../../src/lib/chartGeometry'

describe('niceTicks', () => {
  it('starts at zero and ends at or past the largest value', () => {
    expect(niceTicks(3, 87)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })

  it('covers negative values too', () => {
    expect(niceTicks(-11, 24)).toEqual([-20, -10, 0, 10, 20, 30])
  })

  it('gives a usable axis for a flat zero series', () => {
    expect(niceTicks(0, 0)).toEqual([0, 1])
  })
})

describe('scaleLinear', () => {
  it('maps the domain onto the range, flipping when asked', () => {
    const y = scaleLinear(0, 100, 200, 0)
    expect(y(0)).toBe(200)
    expect(y(25)).toBe(150)
    expect(y(100)).toBe(0)
  })

  it('puts a flat domain in the middle', () => {
    expect(scaleLinear(5, 5, 0, 100)(5)).toBe(50)
  })
})

describe('labels', () => {
  it('formats axis numbers briefly', () => {
    expect(formatTick(0)).toBe('0')
    expect(formatTick(0.25)).toBe('0.25')
    expect(formatTick(1500)).toBe('1.5k')
    expect(formatTick(2_000_000)).toBe('2M')
  })

  it('cuts long labels with an ellipsis', () => {
    expect(truncateLabel('Northern Mariana Islands', 12)).toBe('Northern Ma…')
    expect(truncateLabel('Alaska', 12)).toBe('Alaska')
  })

  it('prints every label when they fit, and an even spread that ends on the last when they do not', () => {
    expect([...thinIndexes(5, 8)]).toEqual([0, 1, 2, 3, 4])
    const thin = [...thinIndexes(30, 8)].sort((a, b) => a - b)
    expect(thin[0]).toBe(0)
    expect(thin[thin.length - 1]).toBe(29)
    expect(thin.length).toBeLessThanOrEqual(9)
  })
})

describe('arcPath', () => {
  it('draws a half ring that ends opposite its start', () => {
    expect(arcPath(100, 100, 40, 80, 0, Math.PI)).toBe('M100.00 20.00A80 80 0 0 1 100.00 180.00L100.00 140.00A40 40 0 0 0 100.00 60.00Z')
  })

  it('uses the large-arc flag past a half turn', () => {
    expect(arcPath(0, 0, 10, 20, 0, 4)).toContain(' 0 1 1 ')
  })
})

describe('limitGroups', () => {
  const labels = ['a', 'b', 'c', 'd', 'e']
  const values = [5, 40, 3, 20, 1]

  it('combines the tail as Other for totals and counts', () => {
    const out = limitGroups(labels, values, 3, true)
    expect(out.labels).toEqual(['b', 'd', 'Other'])
    expect(out.values).toEqual([40, 20, 9])
    expect(out.note).toBe('Showing the 2 largest of 5 groups. The remaining 3 are combined as "Other".')
  })

  it('drops the tail for averages and says so', () => {
    const out = limitGroups(labels, values, 3, false)
    expect(out.labels).toEqual(['b', 'd', 'a'])
    expect(out.note).toBe('Showing the 3 largest of 5 groups. 2 smaller groups are not plotted.')
  })

  it('leaves a short list alone', () => {
    expect(limitGroups(labels, values, 5, true)).toEqual({ labels, values, note: null })
  })
})

describe('pieIsCrowded and isTimeAxis', () => {
  it('calls a pie crowded with more than six groups, or when Other would be its largest part', () => {
    const labels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    expect(pieIsCrowded(labels, [9, 8, 7, 6, 5, 4, 3, 2], true)).toBe(true)
    expect(pieIsCrowded(['a', 'b', 'c'], [5, 4, 3], true)).toBe(false)
    expect(pieIsCrowded(labels.slice(0, 6), [10, 10, 10, 10, 10, 10], true)).toBe(false)
  })

  it('treats months, dates and numbers as a time axis and names as categories', () => {
    expect(isTimeAxis(['2025-10', '2025-11'])).toBe(true)
    expect(isTimeAxis(['2026-01-05', '2026-01-06'])).toBe(true)
    expect(isTimeAxis(['1', '2.5', '10'])).toBe(true)
    expect(isTimeAxis(['Alaska', 'Nevada'])).toBe(false)
    expect(isTimeAxis([])).toBe(false)
  })
})

describe('lineNeedsOrder and tickPlacement', () => {
  it('flags a line or area over category names, never over months, dates or numbers', () => {
    expect(lineNeedsOrder('line', ['Alaska', 'Nevada'])).toBe(true)
    expect(lineNeedsOrder('area', ['Alaska', 'Nevada'])).toBe(true)
    expect(lineNeedsOrder('line', ['2025-10', '2025-11'])).toBe(false)
    expect(lineNeedsOrder('bar', ['Alaska', 'Nevada'])).toBe(false)
  })

  it('keeps a centred label centred, and pushes the first and last label inside the chart', () => {
    expect(tickPlacement(300, 'Texas', 600)).toEqual({ x: 300, anchor: 'middle' })
    expect(tickPlacement(30, 'Puerto Rico', 600)).toEqual({ x: 2, anchor: 'start' })
    expect(tickPlacement(590, 'Tennessee', 600)).toEqual({ x: 598, anchor: 'end' })
  })
})
