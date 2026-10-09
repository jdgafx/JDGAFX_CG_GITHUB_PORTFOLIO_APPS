import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { HARD_STOP_GRACE_MS, HEARTBEAT_MS, RUN_BUDGET_MS } from '../../netlify/functions/run'
import type { Frame } from '../../netlify/shared/events'
import { BUDGET_MESSAGE } from '../../netlify/shared/openrouter'

// The stream itself: its first frame, its heartbeat, its end, and its hard stop when the run never returns.
// The graph is replaced by a function the test controls, so no model or Wikipedia call is involved.
const run = vi.hoisted(() => ({
  impl: ((): Promise<void> => new Promise<void>(() => undefined)) as (
    question: string,
    deps: unknown,
    emit: (frame: Frame) => void,
  ) => Promise<void>,
}))
vi.mock('../../netlify/shared/graph/stream', () => ({
  runResearch: (question: string, deps: unknown, emit: (frame: Frame) => void) => run.impl(question, deps, emit),
}))

const originalKey = process.env.OPENROUTER_API_KEY
let ipCounter = 0

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
  vi.useFakeTimers()
  run.impl = () => new Promise<void>(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalKey
})

async function start(): Promise<Response> {
  ipCounter += 1
  return handler(
    new Request('https://jdgafx-app-11-langgraph-research-agent.netlify.app/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': `198.51.100.${ipCounter}` },
      body: JSON.stringify({ question: 'What is Lisbon?' }),
    }),
  )
}

const logs = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((call) => `${String(call[0])} ${String(call[1] ?? '')}`)

describe('the hard stop', () => {
  it('closes a hung run with the budget message and [DONE], before 30 seconds', async () => {
    const reading = (await start()).text()
    await vi.advanceTimersByTimeAsync(RUN_BUDGET_MS + HARD_STOP_GRACE_MS)

    const text = await reading
    expect(RUN_BUDGET_MS + HARD_STOP_GRACE_MS).toBeLessThan(30_000)
    expect(text.endsWith(`data: ${JSON.stringify({ type: 'error', message: BUDGET_MESSAGE })}\n\ndata: [DONE]\n\n`)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the first frame and the heartbeat', () => {
  it('sends the run id first, then a comment line every five seconds while the run works', async () => {
    const reader = (await start()).body?.getReader()
    if (!reader) throw new Error('No body.')
    const decoder = new TextDecoder()
    const read = async () => decoder.decode((await reader.read()).value)

    const first = await read()
    expect(first).toMatch(/^data: \{"type":"run_start","runId":"[0-9a-f]{8}"\}\n\n$/)

    expect(HEARTBEAT_MS).toBe(5_000)
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS - 1)
    // Nothing has been queued yet, so the next read has to wait for the beat.
    const pending = read()
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBe(': ping\n\n')

    const second = read()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
    expect(await second).toBe(': ping\n\n')
    await reader.cancel()
  })

  it('stops the heartbeat and every timer when the run ends, and closes with [DONE]', async () => {
    run.impl = async (_q, _d, emit) => {
      emit({ type: 'error', message: 'No.' })
    }
    const reading = (await start()).text()
    await vi.advanceTimersByTimeAsync(0)

    const text = await reading
    expect(text).toMatch(/data: \{"type":"error","message":"No\."\}\n\ndata: \[DONE\]\n\n$/)
    expect(text).not.toContain(': ping')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops the heartbeat and every timer when the visitor goes away, and aborts the run', async () => {
    let signal: AbortSignal | undefined
    run.impl = (_q, deps) => {
      signal = (deps as { signal: AbortSignal }).signal
      return new Promise<void>(() => undefined)
    }
    const response = await start()
    const reader = response.body?.getReader()
    await reader?.read()
    await reader?.cancel()

    expect(signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the run log', () => {
  it('writes one line at the start and one at the end, with the run id, outcome, time and frame count, and no question', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    run.impl = async (_q, _d, emit) => {
      await new Promise((resolve) => setTimeout(resolve, 1_200))
      emit({ type: 'error', message: 'No.' })
    }
    const reading = (await start()).text()
    await vi.advanceTimersByTimeAsync(1_200)
    const text = await reading

    const runId = /"runId":"([0-9a-f]{8})"/.exec(text)?.[1]
    const lines = logs(spy)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(`GraphScout: run start {"runId":"${runId}"}`)
    expect(lines[1]).toMatch(new RegExp(`^GraphScout: run end \\{"runId":"${runId}","outcome":"error","totalMs":12\\d\\d,"frames":2\\}$`))
    expect(lines.join(' ')).not.toContain('Lisbon')
  })

  it('names a hard stop, and a cancelled stream, as such', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const reading = (await start()).text()
    await vi.advanceTimersByTimeAsync(RUN_BUDGET_MS + HARD_STOP_GRACE_MS)
    await reading
    expect(logs(spy)[1]).toMatch(/"outcome":"hard-stop","totalMs":27000,"frames":2\}$/)

    spy.mockClear()
    const reader = (await start()).body?.getReader()
    await reader?.read()
    await reader?.cancel()
    expect(logs(spy)[1]).toMatch(/"outcome":"cancelled"/)
  })
})
