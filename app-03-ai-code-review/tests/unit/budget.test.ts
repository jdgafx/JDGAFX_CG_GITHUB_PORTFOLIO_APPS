import { describe, expect, it } from 'vitest'
import { PASS1, PASS2, SAFETY_MS, TOTAL_MS, callLimit } from '../../netlify/shared/budget'

describe('callLimit', () => {
  it('gives pass 1 its own limit, 1.5 times its healthy p95, when the run is fresh', () => {
    expect(PASS1.limitMs).toBe(Math.round(PASS1.p95 * 1.5))
    expect(callLimit(PASS1, TOTAL_MS, PASS2.p50)).toBe(PASS1.limitMs)
  })

  it('gives pass 2 its limit, 1.5 times its healthy p95', () => {
    expect(PASS2.limitMs).toBe(PASS2.p95 * 1.5)
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
