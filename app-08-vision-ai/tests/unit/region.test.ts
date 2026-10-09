import { describe, expect, it } from 'vitest'
import {
  boxFromPoints,
  boxStyle,
  clampBox,
  cropRect,
  isSmallCrop,
  keyedBox,
  moveBox,
  pointerFraction,
  resizeBox,
  shrinkFactor,
} from '../../src/lib/region'

describe('boxFromPoints', () => {
  it('builds the same box whichever corner the drag starts from', () => {
    const expected = { x: 0.2, y: 0.3, w: 0.4, h: 0.1 }
    expect(boxFromPoints({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.4 })).toEqual(expect.objectContaining({ x: 0.2, y: 0.3 }))
    const a = boxFromPoints({ x: 0.6, y: 0.4 }, { x: 0.2, y: 0.3 })!
    expect(a.x).toBeCloseTo(expected.x)
    expect(a.y).toBeCloseTo(expected.y)
    expect(a.w).toBeCloseTo(expected.w)
    expect(a.h).toBeCloseTo(expected.h)
  })

  it('treats a tiny drag (a click) as no box, and clamps a drag that leaves the picture', () => {
    expect(boxFromPoints({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.51 })).toBeNull()
    expect(boxFromPoints({ x: 0.8, y: 0.8 }, { x: 1.4, y: 1.6 })).toEqual({ x: 0.8, y: 0.8, w: expect.closeTo(0.2), h: expect.closeTo(0.2) })
  })
})

describe('moveBox and resizeBox', () => {
  const box = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }

  it('moves by the given share and stops at the picture edge', () => {
    expect(moveBox(box, 0.1, -0.1)).toEqual({ x: 0.5, y: expect.closeTo(0.3), w: 0.2, h: 0.2 })
    expect(moveBox(box, 5, 5)).toEqual({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 })
    expect(moveBox(box, -5, -5)).toEqual({ x: 0, y: 0, w: 0.2, h: 0.2 })
  })

  it('resizes from the top-left corner, never below the minimum or past the picture', () => {
    expect(resizeBox(box, 0.1, 0.05)).toEqual({ x: 0.4, y: 0.4, w: expect.closeTo(0.3), h: expect.closeTo(0.25) })
    expect(resizeBox(box, -1, -1)).toEqual({ x: 0.4, y: 0.4, w: 0.03, h: 0.03 })
    expect(resizeBox(box, 1, 1)).toEqual({ x: 0.4, y: 0.4, w: expect.closeTo(0.6), h: expect.closeTo(0.6) })
  })
})

describe('keyedBox', () => {
  const box = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }

  it('arrow keys move by 2 percent and Shift plus arrow resizes', () => {
    expect(keyedBox(box, 'ArrowRight', false)).toEqual({ x: expect.closeTo(0.42), y: 0.4, w: 0.2, h: 0.2 })
    expect(keyedBox(box, 'ArrowUp', false)).toEqual({ x: 0.4, y: expect.closeTo(0.38), w: 0.2, h: 0.2 })
    expect(keyedBox(box, 'ArrowRight', true)).toEqual({ x: 0.4, y: 0.4, w: expect.closeTo(0.22), h: 0.2 })
    expect(keyedBox(box, 'ArrowUp', true)).toEqual({ x: 0.4, y: 0.4, w: 0.2, h: expect.closeTo(0.18) })
  })

  it('ignores every other key', () => {
    expect(keyedBox(box, 'Enter', false)).toBeNull()
    expect(keyedBox(box, 'a', true)).toBeNull()
  })
})

describe('clampBox', () => {
  it('pulls an out-of-range box back inside the picture', () => {
    expect(clampBox({ x: 0.9, y: -0.2, w: 0.5, h: 2 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
  })
})

describe('pointerFraction', () => {
  it('maps a pointer to fractions of the displayed picture and clamps outside it', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 }
    expect(pointerFraction(300, 150, rect)).toEqual({ x: 0.5, y: 0.5 })
    expect(pointerFraction(0, 999, rect)).toEqual({ x: 0, y: 1 })
    expect(pointerFraction(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('cropRect', () => {
  it('turns fractions into whole source pixels', () => {
    expect(cropRect({ x: 0.25, y: 0.1, w: 0.5, h: 0.4 }, 1280, 853)).toEqual({ x: 320, y: 85, width: 640, height: 341 })
  })

  it('never returns an empty rectangle or one that leaves the picture', () => {
    expect(cropRect({ x: 1, y: 1, w: 0.03, h: 0.03 }, 100, 80)).toEqual({ x: 99, y: 79, width: 1, height: 1 })
    const r = cropRect({ x: 0.97, y: 0, w: 0.5, h: 1 }, 1000, 500)
    expect(r.x + r.width).toBeLessThanOrEqual(1000)
  })

  it('flags a crop whose short side is under 48 pixels', () => {
    expect(isSmallCrop({ x: 0, y: 0, width: 400, height: 47 })).toBe(true)
    expect(isSmallCrop({ x: 0, y: 0, width: 400, height: 48 })).toBe(false)
  })
})

describe('shrinkFactor', () => {
  it('is 1 when the image fits, and otherwise shrinks the edges a little more than the byte ratio needs', () => {
    expect(shrinkFactor(900, 1000)).toBe(1)
    expect(shrinkFactor(4_000_000, 1_000_000)).toBeCloseTo(0.45)
    expect(shrinkFactor(1_000_000_000, 1000)).toBe(0.2)
    expect(shrinkFactor(1001, 1000)).toBeLessThan(0.95 + 1e-9)
  })
})

describe('boxStyle', () => {
  it('writes percent units for the overlay', () => {
    expect(boxStyle({ x: 0.1, y: 0.25, w: 0.5, h: 0.125 })).toEqual({
      left: '10.00%',
      top: '25.00%',
      width: '50.00%',
      height: '12.50%',
    })
  })
})
