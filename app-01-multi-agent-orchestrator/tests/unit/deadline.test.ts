import { afterEach, describe, expect, it, vi } from 'vitest'
import { raceAbort, withDeadline } from '../../netlify/shared/deadline'
import { retrieveSources } from '../../netlify/shared/retrieve'
import { AGENTS } from '../../netlify/shared/agents'
import { runStage } from '../../netlify/shared/stream'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** A body that sends its headers and then never produces a byte and never ends. */
function stalledBody(): Response {
  return new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('withDeadline', () => {
  it('rejects with a TimeoutError at the limit even when the work ignores the abort', async () => {
    vi.useFakeTimers()
    const outcome = withDeadline(1_000, undefined, () => new Promise<string>(() => {})).catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(999)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toMatchObject({ name: 'TimeoutError' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('forwards a parent abort to the work and rejects with the parent reason', async () => {
    const parent = new AbortController()
    let seen: AbortSignal | undefined
    const outcome = withDeadline(60_000, parent.signal, signal => {
      seen = signal
      return new Promise<string>(() => {})
    }).catch((err: unknown) => err)
    parent.abort()
    expect(await outcome).toMatchObject({ name: 'AbortError' })
    expect(seen?.aborted).toBe(true)
  })

  it('returns the value and leaves no timer behind when the work finishes in time', async () => {
    vi.useFakeTimers()
    await expect(withDeadline(1_000, undefined, async () => 'done')).resolves.toBe('done')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('raceAbort passes the work error through when the signal never aborts', async () => {
    await expect(raceAbort(Promise.reject(new Error('boom')), new AbortController().signal)).rejects.toThrow('boom')
  })
})

describe('stalled bodies end at the limit', () => {
  it('a source whose body never finishes is reported as not answering in time', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => stalledBody())
    const started = Date.now()
    const result = await retrieveSources('James Webb telescope', { signal: new AbortController().signal, timeoutMs: 60, fetchImpl })
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(result.reached).toBe(false)
    expect(result.sources).toEqual([])
    expect(result.detail).toBe('No sources retrieved: Wikipedia did not answer in time; Hacker News did not answer in time.')
  })

  it('a model stream that stalls after its headers ends as a timeout at the stage cap', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const fetchMock = vi.fn<typeof fetch>(async () => stalledBody())
    vi.stubGlobal('fetch', fetchMock)
    const agent = AGENTS[0]
    if (!agent) throw new Error('no first stage')
    const provider = { url: 'https://openrouter.example/chat', apiKey: 'test-only-placeholder' }

    const run = runStage(agent, 'Q', provider, Date.now() + 3_000, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(3_000)

    await expect(run).resolves.toMatchObject({ content: '', finish: 'timeout' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
