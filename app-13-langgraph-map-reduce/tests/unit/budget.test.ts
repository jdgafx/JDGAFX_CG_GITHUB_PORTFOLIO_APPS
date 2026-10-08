import { describe, expect, it } from 'vitest'
import { anySignal, createLimiter, pause, RunBudget } from '../../netlify/shared/budget'
import { ProviderError, RunBudgetError } from '../../netlify/shared/errors'

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('createLimiter', () => {
  it('never runs more tasks at once than its limit', async () => {
    const limiter = createLimiter(4)
    const signal = new AbortController().signal
    let running = 0
    let peak = 0
    const task = async (): Promise<void> => {
      running += 1
      peak = Math.max(peak, running)
      await tick(5)
      running -= 1
    }

    await Promise.all(Array.from({ length: 10 }, () => limiter.run(task, signal)))

    expect(peak).toBe(4)
    expect(running).toBe(0)
  })

  it('rejects a queued task with the abort reason and never starts it', async () => {
    const limiter = createLimiter(1)
    const controller = new AbortController()
    let started = 0
    const slow = limiter.run(async () => {
      started += 1
      await tick(20)
    }, controller.signal)
    const queued = limiter.run(async () => {
      started += 1
    }, controller.signal)

    controller.abort(new RunBudgetError())

    await expect(queued).rejects.toBeInstanceOf(RunBudgetError)
    await slow
    expect(started).toBe(1)
  })

  it('does not start a task at all when its signal is already aborted', async () => {
    const limiter = createLimiter(4)
    const controller = new AbortController()
    controller.abort(new RunBudgetError())
    let ran = false

    await expect(
      limiter.run(async () => {
        ran = true
      }, controller.signal),
    ).rejects.toBeInstanceOf(RunBudgetError)
    expect(ran).toBe(false)
  })
})

describe('RunBudget', () => {
  it('aborts its signal with a RunBudgetError when the limit passes', async () => {
    const budget = new RunBudget(10)
    await tick(30)

    expect(budget.expired()).toBe(true)
    expect(budget.signal.reason).toBeInstanceOf(RunBudgetError)
    budget.dispose()
  })

  it('stays live until the limit, and can be cancelled early', () => {
    const budget = new RunBudget(60_000)
    expect(budget.expired()).toBe(false)

    budget.cancel()
    expect(budget.expired()).toBe(true)
    budget.dispose()
  })
})

describe('RunBudget halt', () => {
  it('aborts the run signal with the halting cause, and keeps the first cause', () => {
    const budget = new RunBudget(60_000)
    const first = new ProviderError('rejected')

    budget.halt(first)
    budget.halt(new ProviderError('timeout'))

    expect(budget.signal.aborted).toBe(true)
    expect(budget.signal.reason).toBe(first)
    expect(budget.haltCause()).toBe(first)
    expect(budget.halted()).toBe(true)
    budget.dispose()
  })

  it('is not a deadline: the budget is not reported as expired after a halt', () => {
    const budget = new RunBudget(60_000)

    budget.halt(new ProviderError('rejected'))

    expect(budget.expired()).toBe(false)
    budget.dispose()
  })

  it('rejects a call queued behind the halt with the cause, and never starts it', async () => {
    const budget = new RunBudget(60_000)
    const limiter = createLimiter(1)
    let started = 0
    const first = limiter.run(async () => {
      started += 1
      await new Promise<void>((resolve) => budget.signal.addEventListener('abort', () => resolve(), { once: true }))
    }, budget.signal)
    const queued = limiter.run(async () => {
      started += 1
    }, budget.signal)
    const cause = new ProviderError('rejected')

    budget.halt(cause)

    await expect(queued).rejects.toBe(cause)
    await first
    expect(started).toBe(1)
    budget.dispose()
  })
})

describe('anySignal', () => {
  it('aborts with the reason of the first signal that aborts', () => {
    const a = new AbortController()
    const b = new AbortController()
    const combined = anySignal(a.signal, b.signal)
    const reason = new RunBudgetError()

    b.abort(reason)
    a.abort(new RunBudgetError())

    expect(combined.aborted).toBe(true)
    expect(combined.reason).toBe(reason)
  })

  it('is aborted at once when one of its signals already is', () => {
    const a = new AbortController()
    const reason = new RunBudgetError()
    a.abort(reason)

    expect(anySignal(a.signal, new AbortController().signal).reason).toBe(reason)
  })
})

describe('pause', () => {
  it('resolves once the delay has passed', async () => {
    await expect(pause(1, new AbortController().signal)).resolves.toBeUndefined()
  })

  it('rejects at once with the abort reason when the signal aborts first', async () => {
    const controller = new AbortController()
    const waiting = pause(60_000, controller.signal)

    controller.abort(new RunBudgetError())

    await expect(waiting).rejects.toBeInstanceOf(RunBudgetError)
  })

  it('rejects straight away when the signal has already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new RunBudgetError())

    await expect(pause(60_000, controller.signal)).rejects.toBeInstanceOf(RunBudgetError)
  })
})
