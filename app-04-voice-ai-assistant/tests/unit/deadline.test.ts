import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/transcribe'
import { raceAbort, withDeadline } from '../../netlify/shared/deadline'
import { runModelCall } from '../../netlify/shared/provider'
import { createRecorder } from '../../netlify/shared/trace'
import { runTool } from '../../netlify/shared/tools'
import { PLACEHOLDER, bodyOf, request, restoreEnv, setEnv, stubFetch } from '../helpers'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  restoreEnv()
  vi.restoreAllMocks()
})

/** A reply that sends its headers and then never produces a byte and never ends. */
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

describe('stalled bodies end at the limit with the existing timeout message', () => {
  it('a model reply whose body never finishes becomes the provider timeout message', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    stubFetch(async () => stalledBody())
    const run = createRecorder()
    const pending = runModelCall(PLACEHOLDER, [{ role: 'user', content: 'hi' }], { maxTokens: 64, deadlineAt: Date.now() + 5_000 }, run)
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(pending).resolves.toEqual({ ok: false, httpStatus: 503, message: 'The AI provider did not answer in time.' })
  })

  it('a tool lookup whose body never finishes is reported as not answering in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    stubFetch(async () => stalledBody())
    const pending = runTool('wikipedia_summary', JSON.stringify({ topic: 'Ada Lovelace' }), Date.now() + 25_000)
    await vi.advanceTimersByTimeAsync(3_000)
    const out = await pending
    expect(out.ok).toBe(false)
    expect(out.content).toContain('Wikipedia did not answer in time.')
    expect(out.detail).toBe('No reply before the 3 second limit')
  })

  it('a transcription reply whose body never finishes becomes the 503 timeout message', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    setEnv('DEEPGRAM_API_KEY', PLACEHOLDER)
    stubFetch(async () => stalledBody())
    const mp3 = Buffer.from('ID3 test audio').toString('base64')
    const pending = handler(request('http://localhost/api/transcribe', { json: { audio: mp3, format: 'mp3' } }))
    await vi.advanceTimersByTimeAsync(25_000)
    const res = await pending
    expect(res.status).toBe(503)
    expect((await bodyOf(res)).error).toBe('The transcription service did not answer in time.')
  })
})
