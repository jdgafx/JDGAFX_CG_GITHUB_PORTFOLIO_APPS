import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { streamChat, type StreamOptions } from '../../netlify/shared/stream'
import { TOOL_DEFINITIONS } from '../../netlify/shared/tools'
import { PLACEHOLDER, fixtureChunks, jsonResponse, silentResponse, sseResponse, stubFetch } from '../helpers'

const TURNS = [{ role: 'user' as const, content: 'hi' }]

function options(over: Partial<StreamOptions> = {}): StreamOptions & { texts: string[] } {
  const texts: string[] = []
  return {
    maxTokens: 64,
    tools: TOOL_DEFINITIONS,
    deadlineAt: Date.now() + 25_000,
    firstByteMs: 6_000,
    idleMs: 10_000,
    onText: delta => texts.push(delta),
    texts,
    ...over,
  }
}

describe('streamChat', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads a recorded plain reply: text, served model, finish reason and usage', async () => {
    stubFetch(async () => sseResponse(fixtureChunks('plain')))
    const o = options()
    const out = await streamChat(PLACEHOLDER, TURNS, o)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.text.startsWith('A voice assistant typically works in a few steps')).toBe(true)
    expect(o.texts.join('').trim()).toBe(out.text)
    expect(out.model).toBe('anthropic/claude-haiku-5.5')
    expect(out.finishReason).toBe('stop')
    expect(out.usage).toMatchObject({ prompt_tokens: 558, completion_tokens: 95, total_tokens: 653 })
    expect(out.toolCalls).toEqual([])
  })

  it('builds a tool call from recorded argument fragments, with no text', async () => {
    stubFetch(async () => sseResponse(fixtureChunks('weather')))
    const o = options()
    const out = await streamChat(PLACEHOLDER, TURNS, o)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.toolCalls).toHaveLength(1)
    expect(out.toolCalls[0].function.name).toBe('weather')
    expect(JSON.parse(out.toolCalls[0].function.arguments)).toEqual({ place: 'Lisbon' })
    expect(out.toolCalls[0].id).toMatch(/^toolu_/)
    expect(out.text).toBe('')
    expect(o.texts).toEqual([])
    expect(out.finishReason).toBe('tool_calls')
  })

  it('sends the fixed model, streaming, reasoning off, usage reporting and no temperature', async () => {
    const mock = stubFetch(async () => sseResponse(fixtureChunks('plain')))
    await streamChat(PLACEHOLDER, TURNS, options({ toolChoice: 'none' }))
    const sent = JSON.parse(String(mock.mock.calls[0][1]?.body)) as Record<string, unknown>
    expect(sent).toMatchObject({ model: 'anthropic/claude-haiku-5.5', stream: true, max_tokens: 64, reasoning: { enabled: false }, usage: { include: true }, tool_choice: 'none' })
    expect(sent).not.toHaveProperty('temperature')
  })

  it('reports no data before the first-byte limit as a retryable failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    stubFetch(async (_url, init) => silentResponse(init?.signal))
    const pending = streamChat(PLACEHOLDER, TURNS, options())
    await vi.advanceTimersByTimeAsync(6_000)
    await expect(pending).resolves.toMatchObject({ ok: false, httpStatus: 503, retryable: true, detail: 'No data before the first-byte limit' })
  })

  it('does not call a stall after data retryable, because text may already be heard', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const first = fixtureChunks('plain')[0]
    stubFetch(async (_url, init) => {
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(first))
            init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true })
          },
        }),
        { status: 200 },
      )
    })
    const o = options()
    const pending = streamChat(PLACEHOLDER, TURNS, o)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(pending).resolves.toMatchObject({ ok: false, retryable: false, detail: 'No reply before the time limit' })
    expect(o.texts.length).toBeGreaterThan(0)
  })

  it('stops at once when the visitor cancels, without retrying', async () => {
    stubFetch(async (_url, init) => silentResponse(init?.signal))
    const cancel = new AbortController()
    const pending = streamChat(PLACEHOLDER, TURNS, options({ cancel: cancel.signal }))
    cancel.abort()
    await expect(pending).resolves.toMatchObject({ ok: false, httpStatus: 499, retryable: false })
  })

  it('maps a 402 to the key-or-credit copy and keeps the vendor text out', async () => {
    stubFetch(async () => jsonResponse({ error: { message: 'Insufficient credits for account acct_7781' } }, 402))
    const out = await streamChat(PLACEHOLDER, TURNS, options())
    expect(out).toMatchObject({ ok: false, httpStatus: 502, retryable: false, message: 'The AI provider rejected the key or is out of credit.' })
    expect(JSON.stringify(out)).not.toContain('acct_7781')
  })

  it('maps a dropped connection to the could-not-be-reached copy, retryable', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const out = await streamChat(PLACEHOLDER, TURNS, options())
    expect(out).toMatchObject({ ok: false, httpStatus: 503, retryable: true, message: 'The AI provider could not be reached. Try again in a moment.' })
  })

  it('refuses a reply that is a safety label before any of it goes out', async () => {
    const event = (content: string, model = 'anthropic/claude-haiku-5.5') =>
      `data: ${JSON.stringify({ model, choices: [{ index: 0, delta: { content } }] })}\n\n`
    stubFetch(async () => sseResponse([event('User Safety: '), event('safe'), 'data: [DONE]\n\n']))
    const o = options()
    const out = await streamChat(PLACEHOLDER, TURNS, o)
    expect(out).toMatchObject({ ok: false, httpStatus: 502, message: 'The model returned a label instead of a reply. Try again.' })
    expect(o.texts).toEqual([])
  })

  it('refuses a reply served by a moderation model', async () => {
    const event = `data: ${JSON.stringify({ model: 'meta/llama-guard-4', choices: [{ index: 0, delta: { content: 'Hello there, how can I help?' } }] })}\n\n`
    stubFetch(async () => sseResponse([event]))
    const o = options()
    expect(await streamChat(PLACEHOLDER, TURNS, o)).toMatchObject({ ok: false, httpStatus: 502 })
    expect(o.texts).toEqual([])
  })

  it('keeps a reply that happens to start with a category word, and releases a short reply at the end', async () => {
    const event = (content: string) => `data: ${JSON.stringify({ model: 'anthropic/claude-haiku-5.5', choices: [{ index: 0, delta: { content } }] })}\n\n`
    stubFetch(async () => sseResponse([event('Safety is a '), event('big topic.'), 'data: [DONE]\n\n']))
    const o = options()
    const out = await streamChat(PLACEHOLDER, TURNS, o)
    expect(out.ok && out.text).toBe('Safety is a big topic.')
    expect(o.texts.join('')).toBe('Safety is a big topic.')
  })
})
