import { describe, expect, it } from 'vitest'
import { linearAxis, linePath, logAxis, spreadLabels, tickIndices } from '../../src/lib/chartGeometry'

describe('linearAxis', () => {
  it('rounds the top up to a 1, 2 or 5 step and places values proportionally', () => {
    const axis = linearAxis(9, 10, 110)
    expect(axis.ticks).toEqual([0, 5, 10])
    expect(axis.y(0)).toBe(110)
    expect(axis.y(5)).toBe(60)
    expect(axis.y(10)).toBe(10)
  })

  it('handles an all-zero series', () => {
    expect(linearAxis(0, 10, 110).ticks).toEqual([0])
  })
})

describe('logAxis', () => {
  it('ticks each power of ten and cannot place zero', () => {
    const axis = logAxis([10, 1000], 0, 100)
    expect(axis.ticks).toEqual([10, 100, 1000])
    expect(axis.y(100)).toBe(50)
    expect(axis.y(0)).toBeNull()
  })
})

describe('linePath', () => {
  const axis = linearAxis(10, 0, 100)

  it('breaks the line at a missing day', () => {
    expect(linePath([0, 10, 20, 30], [10, 5, null, 0], axis)).toBe('M0.0 0.0L10.0 50.0M30.0 100.0L30.0 100.0')
  })

  it('draws a lone point as a zero-length segment so it shows as a dot', () => {
    expect(linePath([0, 10, 20], [null, 5, null], axis)).toBe('M10.0 50.0L10.0 50.0')
  })
})

describe('spreadLabels', () => {
  it('keeps labels 14px apart by moving the lower one down, in the order given', () => {
    expect(spreadLabels([104, 100, 200])).toEqual([
      { y: 114, moved: true },
      { y: 100, moved: false },
      { y: 200, moved: false },
    ])
  })
})

describe('tickIndices', () => {
  it('counts back from the last day at an even step wide enough for the labels', () => {
    expect(tickIndices(10, 100, 40)).toEqual([4, 9])
    expect(tickIndices(1, 100, 40)).toEqual([0])
    expect(tickIndices(5, 1000, 40)).toEqual([0, 1, 2, 3, 4])
  })
})
