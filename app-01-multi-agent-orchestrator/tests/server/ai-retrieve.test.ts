import { describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/ai'
import {
  installHarness,
  VALID_BODY,
  frames,
  plan,
  providerCalls,
  reply,
  request,
  stubFetch,
  type PublicReply,
} from './helpers'

installHarness()

describe('ai function: retrieval', () => {
  it('retrieves real sources first, hands them to the Researcher, and ends the report with a Sources list built from them', async () => {
    const fetchMock = plan({
      researcher: reply('- SSE is one-way [1].\n- WebSockets are two-way [2].', 0.0001, 120, 40),
      analyst: reply('- One-way push fits LLM output [1].', 0.00008, 150, 30),
      critic: reply('- No benchmark is cited.', 0.00005, 180, 20),
      synthesizer: reply('SSE fits one-way output [1]. WebSockets are two-way [2].', 0.0004, 300, 90),
    })

    const events = await frames(await handler(request(VALID_BODY)))

    const retrieved = events[1] as { sources: Array<{ n: number; title: string; url: string; site: string }>; detail: string; ms: number }
    expect(events[0]).toEqual({ type: 'retrieve_start' })
    expect(retrieved.sources.map(source => [source.n, source.site, source.title, source.url])).toEqual([
      [1, 'Wikipedia', 'Server-sent events', 'https://en.wikipedia.org/wiki/Server-sent_events'],
      [2, 'Wikipedia', 'WebSocket', 'https://en.wikipedia.org/wiki/WebSocket'],
      [3, 'Hacker News', 'Server-sent events vs WebSockets for streaming', 'https://news.ycombinator.com/item?id=31010000'],
    ])
    expect(typeof retrieved.ms).toBe('number')

    const researcherMessage = (JSON.parse(String(providerCalls(fetchMock)[0]?.[1]?.body)) as { messages: Array<{ content: string }> }).messages[1]?.content
    expect(researcherMessage).toContain('[1] Wikipedia: Server-sent events\nServer-sent events (SSE) is a technology')
    expect(researcherMessage).toContain('[3] Hacker News: Server-sent events vs WebSockets for streaming')

    const finalChunk = events.find(event => event.type === 'agent_chunk' && event.agent === 'synthesizer')?.content as string
    expect(finalChunk).toBe(
      [
        'SSE fits one-way output [1]. WebSockets are two-way [2].',
        '',
        '### Sources',
        '',
        '1. [Server-sent events](https://en.wikipedia.org/wiki/Server-sent_events) - Wikipedia',
        '2. [WebSocket](https://en.wikipedia.org/wiki/WebSocket) - Wikipedia',
        '3. [Server-sent events vs WebSockets for streaming](https://news.ycombinator.com/item?id=31010000) - Hacker News, 210 points, 88 comments, Apr 2022',
        '',
      ].join('\n'),
    )
  })

  it('degrades honestly when both public sources fail: no sources, the trace says why, the Researcher is told', async () => {
    const down = () => new Response('unavailable', { status: 503 })
    const fetchMock = plan(
      {
        researcher: reply('No sources retrieved: working from model memory, unverified.\n- SSE is one-way.', 0.0001, 120, 40),
        analyst: reply('- One-way push fits LLM output.', 0.00008, 150, 30),
        critic: reply('- Nothing is cited.', 0.00005, 180, 20),
        synthesizer: reply('SSE is one-way.', 0.0004, 300, 90),
      },
      { wikipedia: down, hn: down },
    )

    const events = await frames(await handler(request(VALID_BODY)))

    expect(events[1]).toEqual({
      type: 'retrieve_complete',
      ms: expect.any(Number),
      sources: [],
      detail: 'No sources retrieved: Wikipedia answered HTTP 503; Hacker News answered HTTP 503.',
    })
    const researcherMessage = (JSON.parse(String(providerCalls(fetchMock)[0]?.[1]?.body)) as { messages: Array<{ content: string }> }).messages[1]?.content
    expect(researcherMessage).toContain('Sources: none were retrieved.')
    expect(providerCalls(fetchMock)).toHaveLength(4)
    const finalChunk = events.find(event => event.type === 'agent_chunk' && event.agent === 'synthesizer')?.content as string
    expect(finalChunk).toContain('### Sources\n\nNo sources were retrieved. This report rests on model memory and is unverified.')
    expect(events.at(-1)).toMatchObject({
      type: 'session_complete',
      trace: [expect.objectContaining({ name: 'Retrieve', status: 'failed' }), ...Array.from({ length: 4 }, () => expect.objectContaining({ status: 'ok' }))],
    })
  })

  it('keeps retrieval out of the model usage totals', async () => {
    plan({
      researcher: reply('- A [1].', 0.5, 100, 10),
      analyst: reply('- B [1].', 0.25, 100, 10),
      critic: reply('- C.', 0.125, 100, 10),
      synthesizer: reply('D [1].', 0.0625, 100, 10),
    })
    const events = await frames(await handler(request(VALID_BODY)))
    expect(events.at(-1)).toMatchObject({ usage: { prompt_tokens: 400, completion_tokens: 40, total_tokens: 440, cost: 0.9375 } })
  })

  it('stops during retrieval when the visitor leaves, aborts both lookups and calls no model', async () => {
    const leave = new AbortController()
    const stalled: PublicReply = init =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const fetchMock = stubFetch(() => {
      throw new Error('the model must not be called')
    }, { wikipedia: stalled, hn: stalled })

    const res = await handler(request(VALID_BODY, { signal: leave.signal }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    leave.abort()
    const events = await frames(res)

    expect(events.map(event => event.type)).toEqual(['retrieve_start'])
    expect(providerCalls(fetchMock)).toHaveLength(0)
    expect(fetchMock.mock.calls.every(call => call[1]?.signal?.aborted)).toBe(true)
  })
})
