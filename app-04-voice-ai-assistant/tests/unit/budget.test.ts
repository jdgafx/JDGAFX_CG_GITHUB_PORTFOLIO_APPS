import { describe, expect, it } from 'vitest'
import { CLIENT_TIMEOUT_MS } from '../../src/lib/api'
import { IDLE_MS, OVERALL_MS } from '../../src/lib/chatStream'
import { CLIENT_GRACE_MS, PING_MS, RUN_BUDGET_MS, TRANSCRIBE_BUDGET_MS } from '../../netlify/shared/budget'

// The browser must outwait the server's worst case, so the server's own clear error (with its usage) is what
// the visitor sees, never the browser's "no answer". Both sides read the numbers from netlify/shared/budget.ts.
describe('client waits outlast the server budget', () => {
  it('keeps a 3 s grace for the network and a cold start', () => {
    expect(CLIENT_GRACE_MS).toBeGreaterThanOrEqual(3_000)
  })

  it('/api/transcribe: the browser limit is at least the upstream limit plus the grace', () => {
    expect(CLIENT_TIMEOUT_MS).toBeGreaterThanOrEqual(TRANSCRIBE_BUDGET_MS + CLIENT_GRACE_MS)
  })

  it('/api/ai: the overall limit is at least the run budget plus the grace', () => {
    expect(OVERALL_MS).toBeGreaterThanOrEqual(RUN_BUDGET_MS + CLIENT_GRACE_MS)
  })

  it('/api/ai: the idle limit is at least the server ping interval plus the grace', () => {
    expect(IDLE_MS).toBeGreaterThanOrEqual(PING_MS + CLIENT_GRACE_MS)
  })

  it('no browser limit passes the platform cut-off of about 30 s', () => {
    expect(CLIENT_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
    expect(OVERALL_MS).toBeLessThanOrEqual(30_000)
  })
})
