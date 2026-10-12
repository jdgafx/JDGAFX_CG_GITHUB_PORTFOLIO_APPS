import { describe, expect, it } from 'vitest'
import { MS_PER_TOKEN_WORST, PASS1, PASS2, PLATFORM_CUTOFF_MS, SAFETY_MS, SHARD_MAX_TOKENS, TOTAL_MS, callLimit } from '../../netlify/shared/budget'

// A review is three function requests (pass 1, then the two reads of pass 2 side by side), each with its own clock. The numbers
// are pinned here with their sources, which are in the header of netlify/shared/budget.ts: 26 s is the smaller of the platform
// figures found (this app's earlier "~26 s cut-off" and the 2026-10-07 audit; SYSTEM.md's 30 s is app-13's), and 21 s and 22 s come
// from the thinking-on measurements of 2026-10-12 (pass 1 up to 20.6 s, a read up to 15.1 s).
describe('the time budget of the three requests', () => {
  it('pins the platform cut-off at the smaller figure, 26 s', () => {
    expect(PLATFORM_CUTOFF_MS).toBe(26_000)
  })

  it('pins the pass 1 limit at 21 s and the limit of each read at 22 s', () => {
    expect(PASS1.limitMs).toBe(21_000)
    expect(PASS2.limitMs).toBe(22_000)
  })

  // Measured 2026-10-12 (.acceptance/dw/es/app-03-prod-cause-2026-10-12/): every parallel pass-1 call after the first waits up to 6.9 s for a
  // function instance before the handler's clock starts. The browser aborts at 30 s and the platform cuts at about 30 s.
  it('keeps a non-first parallel pass 1 call under 30 s at the browser: 6.9 s instance wait + the limit + 2 s margin', () => {
    expect(6_900 + PASS1.limitMs + 2_000).toBeLessThan(30_000)
  })

  it('keeps every call, its safety margin included, inside the platform cut-off, and the request budget under it', () => {
    expect(PASS1.limitMs + SAFETY_MS).toBeLessThan(PLATFORM_CUTOFF_MS)
    expect(PASS2.limitMs + SAFETY_MS).toBeLessThan(PLATFORM_CUTOFF_MS)
    expect(TOTAL_MS).toBeLessThan(PLATFORM_CUTOFF_MS)
  })

  it('gives the slowest measured calls room: the limit is above the measured p95 of each pass', () => {
    expect(PASS1.limitMs).toBeGreaterThan(PASS1.p95)
    expect(PASS2.limitMs).toBeGreaterThan(PASS2.p95)
    expect(PASS1.p50).toBeLessThan(PASS1.p95)
    expect(PASS2.p50).toBeLessThan(PASS2.p95)
  })

  it('gives a fresh request the whole limit of its call', () => {
    expect(callLimit(PASS1, TOTAL_MS)).toBe(PASS1.limitMs)
    expect(callLimit(PASS2, TOTAL_MS)).toBe(PASS2.limitMs)
  })

  it('shrinks a call to what is left of the request, keeping the safety margin', () => {
    expect(callLimit(PASS2, 20_000)).toBe(20_000 - SAFETY_MS)
  })

  it('refuses a call that could not finish at a healthy pace', () => {
    expect(callLimit(PASS2, PASS2.p50 + SAFETY_MS - 1)).toBeNull()
  })

  it('does not retry pass 1 after a full-length hang: not enough of the request is left', () => {
    expect(callLimit(PASS1, TOTAL_MS - PASS1.limitMs)).toBeNull()
  })

  it('does retry pass 1 after a connection that failed in the first two seconds', () => {
    expect(callLimit(PASS1, TOTAL_MS - 2_000)).toBe(PASS1.limitMs)
  })

  // A shard's reply is capped at what the slowest measured rate (4.75 ms a token, SP2 round 3) writes inside the limit, 2 s kept for the prompt.
  it('caps a pass 1 shard at the tokens the measured rate fits in the limit: 4,000', () => {
    expect(MS_PER_TOKEN_WORST).toBe(4.75)
    expect(SHARD_MAX_TOKENS).toBe(4_000)
    expect(SHARD_MAX_TOKENS * MS_PER_TOKEN_WORST + 2_000).toBeLessThanOrEqual(PASS1.limitMs)
    expect((SHARD_MAX_TOKENS + 100) * MS_PER_TOKEN_WORST + 2_000).toBeGreaterThan(PASS1.limitMs)
  })
})
