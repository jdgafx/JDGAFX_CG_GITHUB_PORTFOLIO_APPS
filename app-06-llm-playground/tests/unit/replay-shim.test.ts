import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installReplayShim, type Recording } from '../../src/replay'
import { COMPARE_BODY, COMPARE_REQUEST, JUDGE_BODY, JUDGE_REQUEST, recording } from '../replay-fixture'

const ORIGIN = 'http://app.test'

function setup(rec: Recording = recording(), speed = 1) {
  const original = vi.fn(async () => new Response('REAL NETWORK', { status: 200 }))
  const target = { fetch: original as unknown as typeof fetch }
  const onDiverge = vi.fn()
  const onDone = vi.fn()
  const shim = installReplayShim(rec, { target, origin: ORIGIN, speed, onDiverge, onDone })
  return { original, target, shim, onDiverge, onDone, call: (path: string, body: string | null, init: RequestInit = {}) => target.fetch(path, { method: 'POST', body, ...init }) }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('replay fetch shim', () => {
  it('answers the app\'s calls from the recording at the recorded times, in order, and never touches the network', async () => {
    const { call, original, onDone, onDiverge } = setup()
    const t0 = Date.now()
    const log: [string, number][] = []
    const compare = call('/api/compare', COMPARE_REQUEST).then(async res => {
      log.push(['compare headers', Date.now() - t0])
      const body = await res.json()
      log.push(['compare body', Date.now() - t0])
      const judge = await call('/api/judge', JUDGE_REQUEST)
      log.push(['judge headers', Date.now() - t0])
      return { body, judge: await judge.json() }
    })
    await vi.advanceTimersByTimeAsync(3999)
    expect(log).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(log[0]).toEqual(['compare headers', 4000])
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2900)
    const result = await compare
    expect(log.map(([name]) => name)).toEqual(['compare headers', 'compare body', 'judge headers'])
    expect(log[1][1]).toBe(4100)
    expect(log[2][1]).toBe(7000)
    expect(result.body).toEqual(COMPARE_BODY)
    expect(result.judge).toEqual(JUDGE_BODY)
    expect(original).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDiverge).not.toHaveBeenCalled()
  })

  it('delivers a streamed body chunk by chunk at each chunk\'s time', async () => {
    const { call } = setup()
    const res = await (async () => {
      const pending = call('/api/compare', COMPARE_REQUEST)
      await vi.advanceTimersByTimeAsync(4000)
      return pending
    })()
    const reader = res.body!.getReader()
    const seen: number[] = []
    const t0 = Date.now() - 4000
    const first = await reader.read()
    seen.push(Date.now() - t0)
    expect(first.done).toBe(false)
    const second = reader.read().then(r => {
      seen.push(Date.now() - t0)
      return r
    })
    await vi.advanceTimersByTimeAsync(100)
    expect((await second).done).toBe(false)
    expect(seen).toEqual([4000, 4100])
    expect((await reader.read()).done).toBe(true)
  })

  it('follows the recorded gaps scaled by the stated speed', async () => {
    const { call } = setup(recording(), 2)
    const t0 = Date.now()
    let arrived = -1
    void call('/api/compare', COMPARE_REQUEST).then(() => (arrived = Date.now() - t0))
    await vi.advanceTimersByTimeAsync(1999)
    expect(arrived).toBe(-1)
    await vi.advanceTimersByTimeAsync(1)
    expect(arrived).toBe(2000)
  })

  it('is removed as soon as the last reply is delivered, and puts the very same fetch back', async () => {
    const { call, target, original, shim } = setup()
    expect(target.fetch).not.toBe(original)
    expect(shim.active).toBe(true)
    const compare = call('/api/compare', COMPARE_REQUEST)
    await vi.advanceTimersByTimeAsync(4100)
    await (await compare).text()
    expect(target.fetch).not.toBe(original)
    const judge = call('/api/judge', JUDGE_REQUEST)
    await vi.advanceTimersByTimeAsync(2900)
    await (await judge).text()
    expect(shim.active).toBe(false)
    expect(target.fetch).toBe(original)
  })

  it('passes calls that are not the app\'s own /api calls straight through', async () => {
    const { target, original } = setup()
    await target.fetch('https://fonts.example/x.css')
    await target.fetch('/favicon.svg')
    await target.fetch('https://other.test/api/compare', { method: 'POST' })
    expect(original).toHaveBeenCalledTimes(3)
  })

  it('refuses an /api call the recording cannot answer, sends nothing, and ends the replay', async () => {
    const { call, original, target, onDiverge, shim } = setup()
    await expect(call('/api/vote', JSON.stringify({ choice: 'A' }))).rejects.toBeInstanceOf(TypeError)
    expect(original).not.toHaveBeenCalled()
    expect(onDiverge).toHaveBeenCalledTimes(1)
    expect(shim.active).toBe(false)
    expect(target.fetch).toBe(original)
  })

  it('treats a request that differs from the recorded one as a divergence, not a reply', async () => {
    const { call, original, onDiverge } = setup()
    await expect(call('/api/compare', JSON.stringify({ prompt: 'another prompt' }))).rejects.toBeInstanceOf(TypeError)
    expect(onDiverge).toHaveBeenCalledTimes(1)
    expect(original).not.toHaveBeenCalled()
  })

  it('answers each recorded exchange once', async () => {
    const { call, onDiverge } = setup()
    const first = call('/api/compare', COMPARE_REQUEST).catch((e: unknown) => e)
    await expect(call('/api/compare', COMPARE_REQUEST)).rejects.toBeInstanceOf(TypeError)
    expect(onDiverge).toHaveBeenCalledTimes(1)
    expect(await first).toMatchObject({ name: 'AbortError' })
  })

  it('ends with an abort error when the app stops the request, and puts fetch back', async () => {
    const { call, target, original, onDiverge, onDone } = setup()
    const controller = new AbortController()
    const pending = call('/api/compare', COMPARE_REQUEST, { signal: controller.signal })
    const caught = pending.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1000)
    controller.abort()
    const err = await caught
    expect(err).toMatchObject({ name: 'AbortError' })
    expect(target.fetch).toBe(original)
    expect(onDiverge).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('errors a body that is still streaming when the replay is stopped', async () => {
    const { call, shim } = setup()
    const pending = call('/api/compare', COMPARE_REQUEST)
    await vi.advanceTimersByTimeAsync(4000)
    const res = await pending
    shim.stop()
    await expect(res.text()).rejects.toMatchObject({ name: 'AbortError' })
    shim.stop()
  })

  it('survives a client that cancels its reader before the end event and then asks for the next reply', async () => {
    const { call, onDone, onDiverge } = setup()
    const pending = call('/api/compare', COMPARE_REQUEST)
    await vi.advanceTimersByTimeAsync(4000)
    const res = await pending
    const reader = res.body!.getReader()
    await reader.read()
    await reader.cancel()
    // The clock passes the recorded end (4100) without its timer having run, so the next fetch finds overdue events.
    vi.setSystemTime(Date.now() + 200)
    const next = call('/api/judge', JUDGE_REQUEST)
    await vi.advanceTimersByTimeAsync(3000)
    const judge = await next
    expect(await judge.json()).toEqual(JUDGE_BODY)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDiverge).not.toHaveBeenCalled()
  })

  it('does not stay installed when the app never makes the last recorded call', async () => {
    const { call, target, original, onDiverge } = setup()
    void call('/api/compare', COMPARE_REQUEST).then(r => r.text())
    await vi.advanceTimersByTimeAsync(7000 + 2000)
    expect(onDiverge).toHaveBeenCalledTimes(1)
    expect(target.fetch).toBe(original)
  })
})
