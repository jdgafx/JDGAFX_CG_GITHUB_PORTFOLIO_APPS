import { describe, expect, it } from 'vitest'
import {
  BUDGET_MESSAGE,
  isFatal,
  plainMessage,
  ProviderError,
  reportedFailure,
  RunBudgetError,
  SERVER_MESSAGE,
} from '../../netlify/shared/errors'

describe('reportedFailure', () => {
  it('picks the fatal failure out of a parallel step, not the first transient one', () => {
    const aggregate = new AggregateError([new ProviderError('unavailable'), new ProviderError('rejected')])

    expect(reportedFailure(aggregate)).toBeInstanceOf(ProviderError)
    expect((reportedFailure(aggregate) as ProviderError).kind).toBe('rejected')
  })

  it('returns a plain error unchanged', () => {
    const plain = new Error('boom')

    expect(reportedFailure(plain)).toBe(plain)
  })
})

describe('plainMessage', () => {
  it('uses the message of a known failure', () => {
    expect(plainMessage(new ProviderError('rate_limited'), false)).toBe('Rate limited, try again in a minute.')
  })

  it('reports the budget when time ran out, and the generic message for anything unknown', () => {
    expect(plainMessage(new Error('socket reset'), true)).toBe(BUDGET_MESSAGE)
    expect(plainMessage(new RunBudgetError(), false)).toBe(BUDGET_MESSAGE)
    expect(plainMessage(new Error('socket reset'), false)).toBe(SERVER_MESSAGE)
  })
})

describe('fatal failures', () => {
  it('only a rejected key or an empty credit account halts the run', () => {
    expect(new ProviderError('rejected').fatal).toBe(true)
    for (const kind of ['rate_limited', 'bad_request', 'timeout', 'unavailable', 'network'] as const) {
      expect(new ProviderError(kind).fatal).toBe(false)
    }
  })

  it('counts a budget error as fatal, and a plain error as not', () => {
    expect(isFatal(new RunBudgetError())).toBe(true)
    expect(isFatal(new Error('plain'))).toBe(false)
  })
})
