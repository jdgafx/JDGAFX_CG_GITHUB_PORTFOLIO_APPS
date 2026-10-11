import { describe, expect, it } from 'vitest'
import { PASS1, PASS2, SAFETY_MS, TOTAL_MS, callLimit } from '../../netlify/shared/budget'

describe('callLimit', () => {
  it('keeps the limit of each pass at 1.5 times its healthy p95', () => {
    expect(PASS1.limitMs).toBe(Math.round(PASS1.p95 * 1.5))
    expect(PASS2.limitMs).toBe(Math.round(PASS2.p95 * 1.5))
  })

  it('holds pass 1 to what leaves a healthy pass 2 and the safety margin, when the run is fresh', () => {
    expect(callLimit(PASS1, TOTAL_MS, PASS2.p50)).toBe(TOTAL_MS - SAFETY_MS - PASS2.p50)
    expect(callLimit(PASS1, TOTAL_MS, PASS2.p50)).toBeGreaterThan(PASS1.p95)
  })

  it('fits a healthy run: pass 1 and then pass 2 at their p50 end before the run does', () => {
    expect(PASS1.p50 + PASS2.p50 + SAFETY_MS).toBeLessThan(TOTAL_MS)
  })

  it('gives pass 2 its limit, 1.5 times its healthy p95', () => {
    expect(callLimit(PASS2, TOTAL_MS)).toBe(PASS2.limitMs)
  })

  it('shrinks a call to what is left, keeping the reserve and the safety margin', () => {
    expect(callLimit(PASS2, 9_000)).toBe(9_000 - SAFETY_MS)
  })

  it('refuses a call that could not finish at a healthy pace', () => {
    expect(callLimit(PASS2, PASS2.p50 + SAFETY_MS - 1)).toBeNull()
  })

  it('does not retry pass 1 after a full-length hang: not enough is left for it and for pass 2', () => {
    const left = TOTAL_MS - PASS1.limitMs
    expect(callLimit(PASS1, left, PASS2.p50)).toBeNull()
  })

  it('does retry pass 1 after a connection that failed in the first two seconds', () => {
    expect(callLimit(PASS1, TOTAL_MS - 2_000, PASS2.p50)).toBe(TOTAL_MS - 2_000 - SAFETY_MS - PASS2.p50)
  })
})
