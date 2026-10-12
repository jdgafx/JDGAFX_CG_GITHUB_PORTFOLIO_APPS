import { describe, expect, it } from 'vitest'
import { REQUEST_TIMEOUT_MS } from '../../src/lib/api'
import { CLIENT_GRACE_MS, RUN_BUDGET_MS } from '../../netlify/shared/budget'

// The browser must outwait the server's worst case, so the server's own clear error (with what the run spent)
// is what the visitor sees, never the browser's "no answer". Both sides read the numbers from netlify/shared/budget.ts.
describe('client wait outlasts the server budget', () => {
  it('keeps a 3 s grace for the network and a cold start', () => {
    expect(CLIENT_GRACE_MS).toBeGreaterThanOrEqual(3_000)
  })

  it('/api/ai: the browser limit is at least the run budget plus the grace', () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(RUN_BUDGET_MS + CLIENT_GRACE_MS)
  })

  it('/api/ai: the browser limit stays within the platform cut-off of about 30 s', () => {
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
  })
})
