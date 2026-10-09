import { describe, expect, it } from 'vitest'
import { RequestFailure } from '../../src/lib/api'
import { DECISION_NOT_SENT, outcomeAfterFailure } from '../../src/lib/resume-failure'

const resume = { from: 'paused', eventsArrived: false, resuming: true } as const

describe('outcomeAfterFailure', () => {
  it('keeps a waiting thread paused when the resume never connected', () => {
    const error = new RequestFailure('Could not reach the server.', undefined, true)
    expect(outcomeAfterFailure({ ...resume, error })).toEqual({ phase: 'paused', message: DECISION_NOT_SENT })
  })

  it('keeps a waiting thread paused on a server error before any event', () => {
    for (const status of [500, 502, 503]) {
      const error = new RequestFailure('The server could not start the run.', status)
      expect(outcomeAfterFailure({ ...resume, error }).phase).toBe('paused')
    }
  })

  it('fails the run when the request was refused as invalid or the thread was not found', () => {
    for (const status of [400, 404]) {
      const error = new RequestFailure('The thread id is not valid.', status)
      expect(outcomeAfterFailure({ ...resume, error })).toEqual({ phase: 'failed', message: null })
    }
  })

  it('does not call it a failed run when another maintainer holds or already answered the thread: it reopens the thread', () => {
    for (const message of ['Another maintainer is handling this thread. Refresh to see the result.', 'This thread is not awaiting approval.']) {
      const error = new RequestFailure(message, 409)
      expect(outcomeAfterFailure({ ...resume, error })).toEqual({ phase: 'idle', message: null, reopen: true })
    }
  })

  it('reopens on a 409 from a retry too, but a 409 after events arrived is a failed run', () => {
    const error = new RequestFailure('Another maintainer is handling this thread. Refresh to see the result.', 409)
    expect(outcomeAfterFailure({ from: 'failed', eventsArrived: false, resuming: false, error })).toEqual({ phase: 'idle', message: null, reopen: true })
    expect(outcomeAfterFailure({ ...resume, eventsArrived: true, error })).toEqual({ phase: 'failed', message: null })
  })

  it('keeps a waiting thread paused when the server rate-limited the resume, and shows its own message', () => {
    const error = new RequestFailure('Too many requests from this connection. Wait a minute and try again.', 429)
    expect(outcomeAfterFailure({ ...resume, error })).toEqual({ phase: 'paused', message: null })
    expect(
      outcomeAfterFailure({ from: 'idle', eventsArrived: false, resuming: false, error }),
    ).toEqual({ phase: 'failed', message: null })
  })

  it('fails the run when the failure came after events arrived', () => {
    const error = new RequestFailure('The server stopped sending data.', undefined, true)
    expect(outcomeAfterFailure({ ...resume, eventsArrived: true, error }).phase).toBe('failed')
  })

  it('fails a new run on a lost connection, because there is no card to return to', () => {
    const error = new RequestFailure('Could not reach the server.', undefined, true)
    expect(outcomeAfterFailure({ from: 'idle', eventsArrived: false, resuming: false, error }).phase).toBe('failed')
    expect(outcomeAfterFailure({ from: 'paused', eventsArrived: false, resuming: false, error }).phase).toBe('failed')
  })

  it('fails the run for an error that is not a request failure', () => {
    expect(outcomeAfterFailure({ ...resume, error: new Error('boom') }).phase).toBe('failed')
  })

  it('words the message in plain terms', () => {
    expect(DECISION_NOT_SENT).toBe('The decision did not reach the server. The run is still waiting, so try again.')
  })
})
