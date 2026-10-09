import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { HARD_STOP_GRACE_MS, RUN_BUDGET_MS } from '../../netlify/functions/run'
import { BUDGET_MESSAGE } from '../../netlify/shared/openrouter'

// A run that never returns, even after its budget aborted, must still end the stream before the
// platform cut-off, with the budget message and [DONE].
vi.mock('../../netlify/shared/graph/stream', () => ({
  runResearch: () => new Promise<void>(() => undefined),
}))

const originalKey = process.env.OPENROUTER_API_KEY

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalKey
})

describe('the hard stop', () => {
  it('closes a hung run with the budget message and [DONE], before 30 seconds', async () => {
    const response = await handler(
      new Request('https://jdgafx-app-11-langgraph-research-agent.netlify.app/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': '198.51.100.9' },
        body: JSON.stringify({ question: 'What is Lisbon?' }),
      }),
    )
    const reading = response.text()
    await vi.advanceTimersByTimeAsync(RUN_BUDGET_MS + HARD_STOP_GRACE_MS)

    expect(RUN_BUDGET_MS + HARD_STOP_GRACE_MS).toBeLessThan(30_000)
    expect(await reading).toBe(`data: ${JSON.stringify({ type: 'error', message: BUDGET_MESSAGE })}\n\ndata: [DONE]\n\n`)
  })
})
