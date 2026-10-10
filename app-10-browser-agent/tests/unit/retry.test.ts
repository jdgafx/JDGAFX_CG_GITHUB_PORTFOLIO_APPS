import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequestFailure, streamRun } from '../../src/lib/api'
import { shouldRetryRun } from '../../src/lib/retry'
import { initialRunState, runReducer } from '../../src/lib/runState'
import { buildTraceRows } from '../../src/lib/trace'
import type { BotStep } from '../../src/types'

const steps: BotStep[] = [{ action: 'navigate', target: 'Hacker News', thought: 'Open it.', url: 'https://news.ycombinator.com/' }]

describe('shouldRetryRun', () => {
  const gateway = new RequestFailure('The browser service failed. Try again.', [], true)

  it('retries once for a gateway failure, a cut connection or a stream that ended with no outcome, before any step finished', () => {
    expect(shouldRetryRun(0, false, false, gateway)).toBe(true)
    expect(shouldRetryRun(0, false, false)).toBe(true)
  })

  it.each([
    ['a second failure', () => shouldRetryRun(1, false, false, gateway)],
    ['a failure after a step finished', () => shouldRetryRun(0, true, false, gateway)],
    ['an outcome the server reported itself', () => shouldRetryRun(0, false, true)],
    ['a failure that is not retryable, such as a 429 or a stalled stream', () => shouldRetryRun(0, false, false, new RequestFailure('Too many browser runs'))],
    ['an error that is not a request failure', () => shouldRetryRun(0, false, false, new Error('boom'))],
  ])('does not retry after %s', (_name, decide) => {
    expect(decide()).toBe(false)
  })
})

describe('the retry in the trace', () => {
  it('clears the first attempt and adds a "Retried once" row that stays first among the run rows', () => {
    const failedFirst = runReducer({ ...initialRunState, steps, phase: 'running' }, { type: 'event', event: { type: 'browser', version: '153.0.8010.0' } })
    const again = runReducer(failedFirst, { type: 'retrying' })
    expect(again.phase).toBe('running')
    expect(again.browser).toBeNull()
    expect(again.rows).toEqual([{ index: null, name: 'Retried once', status: 'ok', ms: 0, detail: 'The browser service did not answer, so the run was started again.' }])
    expect(buildTraceRows(again).some((row) => row.name === 'Retried once')).toBe(true)
  })
})

describe('run failures', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows browser-service copy for a 502 from the run, never the AI-provider message, and marks it retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })))
    const failure = await streamRun(steps, () => undefined, new AbortController().signal).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RequestFailure)
    expect((failure as RequestFailure).message).toBe('The browser service failed. Try again.')
    expect((failure as RequestFailure).retryable).toBe(true)
  })

  it('treats a 4xx from the run as final', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'A plan needs 1 to 10 steps.' }), { status: 400 })))
    const failure = await streamRun(steps, () => undefined, new AbortController().signal).catch((error: unknown) => error)
    expect((failure as RequestFailure).retryable).toBe(false)
  })

  it('marks a cut connection while the run starts as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const failure = await streamRun(steps, () => undefined, new AbortController().signal).catch((error: unknown) => error)
    expect((failure as RequestFailure).retryable).toBe(true)
  })
})
