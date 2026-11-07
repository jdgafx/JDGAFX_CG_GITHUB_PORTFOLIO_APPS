import { describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/ai'
import {
  EMPTY_FEED,
  GOOD_RETRIEVAL,
  installHarness,
  VALID_BODY,
  WIKIPEDIA_BODY,
  frames,
  jsonReply,
  plan,
  providerCalls,
  relevanceCalls,
  reply,
  request,
  stubFetch,
  type PublicReply,
} from './helpers'

installHarness()

const WEB_BODY = {
  results: [
    {
      title: 'Streaming LLM output: SSE or WebSockets',
      url: 'https://blog.example.com/sse-or-websockets',
      content: 'Compare SSE and WebSockets for streaming LLM output: SSE is simpler, WebSockets are two-way.',
    },
  ],
}
const ARXIV_FEED = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
  <id>http://arxiv.org/abs/2610.01234v1</id><published>2026-10-02T10:00:00Z</published>
  <title>Streaming LLM output over SSE and WebSockets</title>
  <summary>We compare SSE and WebSockets for streaming LLM output in two settings.</summary>
</entry></feed>`

describe('ai function: retrieval', () => {
  it('retrieves real sources first, hands them to the Researcher, and ends the report with a Sources list built from them', async () => {
    const fetchMock = plan({
      researcher: reply('- SSE is one-way [1].\n- WebSockets are two-way [2].', 0.0001, 120, 40),
      analyst: reply('- One-way push fits LLM output [1].', 0.00008, 150, 30),
      critic: reply('- No benchmark is cited.', 0.00005, 180, 20),
      synthesizer: reply('SSE fits one-way output [1]. WebSockets are two-way [4].', 0.0004, 300, 90),
    }, { ...GOOD_RETRIEVAL, web: jsonReply(WEB_BODY), arxiv: () => new Response(ARXIV_FEED, { status: 200 }) })

    const events = await frames(await handler(request(VALID_BODY)))

    const retrieved = events[1] as { sources: Array<{ n: number; title: string; url: string; site: string }>; detail: string; ms: number }
    expect(events[0]).toEqual({ type: 'retrieve_start' })
    expect(retrieved.sources.map(source => [source.n, source.site, source.title, source.url])).toEqual([
      [1, 'Web', 'Streaming LLM output: SSE or WebSockets', 'https://blog.example.com/sse-or-websockets'],
      [2, 'arXiv', 'Streaming LLM output over SSE and WebSockets', 'https://arxiv.org/abs/2610.01234'],
      [3, 'Hacker News', 'Server-sent events vs WebSockets for streaming LLM output', 'https://news.ycombinator.com/item?id=31010000'],
      [4, 'Wikipedia', 'Server-sent events', 'https://en.wikipedia.org/wiki/Server-sent_events'],
    ])
    expect(retrieved.detail).toBe('Found 1 web page, 1 arXiv paper, 1 Hacker News thread and 1 Wikipedia article. The relevance check kept 4 of 5 results.')
    expect(typeof retrieved.ms).toBe('number')

    const researcherMessage = (JSON.parse(String(providerCalls(fetchMock)[0]?.[1]?.body)) as { messages: Array<{ content: string }> }).messages[1]?.content
    expect(researcherMessage).toContain('[1] Web: Streaming LLM output: SSE or WebSockets\nCompare SSE and WebSockets')
    expect(researcherMessage).toContain('[4] Wikipedia: Server-sent events\nServer-sent events (SSE) is a technology')
    expect(researcherMessage).toContain('[3] Hacker News: Server-sent events vs WebSockets for streaming LLM output')

    const finalChunk = events.find(event => event.type === 'agent_chunk' && event.agent === 'synthesizer')?.content as string
    expect(finalChunk).toBe(
      [
        'SSE fits one-way output [1]. WebSockets are two-way [4].',
        '',
        '### Sources',
        '',
        '1. [Streaming LLM output: SSE or WebSockets](https://blog.example.com/sse-or-websockets) - Web, blog.example.com',
        '2. [Streaming LLM output over SSE and WebSockets](https://arxiv.org/abs/2610.01234) - arXiv, preprint, Oct 2026',
        '3. [Server-sent events vs WebSockets for streaming LLM output](https://news.ycombinator.com/item?id=31010000) - Hacker News, 210 points, 88 comments, Apr 2022',
        '4. [Server-sent events](https://en.wikipedia.org/wiki/Server-sent_events) - Wikipedia',
        '',
      ].join('\n'),
    )
  })

  it('stops before any model call when no source was retrieved: no report, a Failed Retrieve, the four stages not run', async () => {
    const down = () => new Response('unavailable', { status: 503 })
    const fetchMock = plan(
      {
        researcher: reply('No sources retrieved: working from model memory, unverified.\n- SSE is one-way.', 0.0001, 120, 40),
        analyst: reply('- One-way push fits LLM output.', 0.00008, 150, 30),
        critic: reply('- Nothing is cited.', 0.00005, 180, 20),
        synthesizer: reply('SSE is one-way.', 0.0004, 300, 90),
      },
      { wikipedia: down, hn: down, web: down, arxiv: down },
    )

    const events = await frames(await handler(request(VALID_BODY)))

    expect(events.map(event => event.type)).toEqual(['retrieve_start', 'agent_error', 'agent_skipped', 'agent_skipped', 'agent_skipped', 'agent_skipped'])
    expect(events[1]).toEqual({
      type: 'agent_error',
      agent: 'retriever',
      ms: expect.any(Number),
      error:
        'Live data unavailable, so no report was written. No sources retrieved: Web search answered HTTP 503; arXiv answered HTTP 503; Hacker News answered HTTP 503; Wikipedia answered HTTP 503.',
    })
    // Only the data lookups went out (Wikipedia twice): no model call, and not even the model list.
    expect(providerCalls(fetchMock)).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(events.some(event => event.type === 'agent_chunk' || event.type === 'session_complete')).toBe(false)
  })

  it('stops the same way when every source answers but nothing matches', async () => {
    const empty = jsonReply({ query: { pages: [] }, hits: [] })
    const fetchMock = plan(
      { researcher: reply('x', 0, 1, 1), analyst: reply('x', 0, 1, 1), critic: reply('x', 0, 1, 1), synthesizer: reply('x', 0, 1, 1) },
      { wikipedia: empty, hn: empty, web: empty, arxiv: () => new Response(EMPTY_FEED) },
    )
    const events = await frames(await handler(request(VALID_BODY)))
    expect(events.map(event => event.type)).toContain('agent_error')
    expect(events[1]).toMatchObject({ error: 'Live data unavailable, so no report was written. No sources found for this question on the web, arXiv, Hacker News or Wikipedia.' })
    expect(events.some(event => event.type === 'agent_chunk' || event.type === 'session_complete')).toBe(false)
    expect(providerCalls(fetchMock)).toHaveLength(0)
  })

  it('stops before any stage when the relevance check finds nothing in the results about the question, and shows no unrelated source', async () => {
    const none = (init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      const shown = (sent.messages[1]?.content.match(/^\d+\. \[/gm) ?? []).length
      return reply(JSON.stringify({ results: Array.from({ length: shown }, (_, i) => ({ n: i + 1, relevant: false })) }), 0.0002, 600, 50)()
    }
    const fetchMock = plan(
      { researcher: reply('x', 0, 1, 1), analyst: reply('x', 0, 1, 1), critic: reply('x', 0, 1, 1), synthesizer: reply('x', 0, 1, 1) },
      { ...GOOD_RETRIEVAL, web: jsonReply(WEB_BODY), judge: none },
    )
    const events = await frames(await handler(request(VALID_BODY)))
    expect(relevanceCalls(fetchMock)).toHaveLength(1)
    expect(providerCalls(fetchMock)).toHaveLength(0)
    expect(events.some(event => event.type === 'retrieve_complete' || event.type === 'agent_chunk' || event.type === 'session_complete')).toBe(false)
    expect(events[1]).toMatchObject({
      type: 'agent_error',
      agent: 'retriever',
      error: 'Live data unavailable, so no report was written. No sources found for this question on the web, arXiv, Hacker News or Wikipedia. The relevance check kept 0 of 4 results.',
      // The billed relevance call is reported even though the run stops, so the page's total includes it.
      usage: { prompt_tokens: 600, completion_tokens: 50, total_tokens: 650, cost: 0.0002 },
    })
  })

  it('keeps only the sources the relevance check marks relevant, and numbers the Researcher\'s sources from them', async () => {
    const onlyHn = (init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      const lines = sent.messages[1]?.content.split('\n').filter(line => /^\d+\. \[/.test(line)) ?? []
      return reply(JSON.stringify({ results: lines.map((line, i) => ({ n: i + 1, relevant: line.includes('[Hacker News]') })) }), 0.0002, 600, 50)()
    }
    const fetchMock = plan(
      {
        researcher: reply('- A [1].', 0.1, 10, 10),
        analyst: reply('- B [1].', 0.1, 10, 10),
        critic: reply('- C.', 0.1, 10, 10),
        synthesizer: reply('D [1].', 0.1, 10, 10),
      },
      { ...GOOD_RETRIEVAL, web: jsonReply(WEB_BODY), judge: onlyHn },
    )
    const events = await frames(await handler(request(VALID_BODY)))
    const retrieved = events[1] as { sources: Array<{ n: number; site: string }>; detail: string }
    expect(retrieved.sources.map(source => [source.n, source.site])).toEqual([[1, 'Hacker News']])
    expect(retrieved.detail).toBe('Found 1 Hacker News thread. The relevance check kept 1 of 4 results.')
    const researcherMessage = (JSON.parse(String(providerCalls(fetchMock)[0]?.[1]?.body)) as { messages: Array<{ content: string }> }).messages[1]?.content
    expect(researcherMessage).toContain('[1] Hacker News: Server-sent events vs WebSockets')
    expect(researcherMessage).not.toContain('Wikipedia')
  })

  it('keeps going when only one source fails, and names which one was unavailable', async () => {
    const fetchMock = plan(
      {
        researcher: reply('- A [1].', 0.1, 10, 10),
        analyst: reply('- B [1].', 0.1, 10, 10),
        critic: reply('- C.', 0.1, 10, 10),
        synthesizer: reply('D [1].', 0.1, 10, 10),
      },
      { wikipedia: jsonReply(WIKIPEDIA_BODY), hn: () => new Response('unavailable', { status: 503 }) },
    )
    const events = await frames(await handler(request(VALID_BODY)))
    expect(events[1]).toMatchObject({ type: 'retrieve_complete', detail: expect.stringContaining('Hacker News answered HTTP 503') })
    expect(providerCalls(fetchMock)).toHaveLength(4)
    expect(events.at(-1)).toMatchObject({ type: 'session_complete' })
  })

  it('counts the relevance check of Retrieve in the run totals and on the Retrieve step', async () => {
    plan({
      researcher: reply('- A [1].', 0.5, 100, 10),
      analyst: reply('- B [1].', 0.25, 100, 10),
      critic: reply('- C.', 0.125, 100, 10),
      synthesizer: reply('D [1].', 0.0625, 100, 10),
    })
    const events = await frames(await handler(request(VALID_BODY)))
    // The four stages (400 in, 40 out, $0.9375) plus the relevance check (600 in, 100 out, $0.0002).
    expect(events.at(-1)).toMatchObject({ usage: { prompt_tokens: 1000, completion_tokens: 140, total_tokens: 1140, cost: 0.9377 } })
    expect((events.at(-1)?.trace as Array<Record<string, unknown>>)[0]).toMatchObject({ name: 'Retrieve', tokens: 100, cost: 0.0002 })
    // The browser's running total needs the same bill as soon as Retrieve ends, not only at session_complete.
    expect(events.find(event => event.type === 'retrieve_complete')).toMatchObject({ usage: { cost: 0.0002, completion_tokens: 100 } })
  })

  it('stops during retrieval when the visitor leaves, aborts every lookup and calls no model', async () => {
    const leave = new AbortController()
    const stalled: PublicReply = init =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const fetchMock = stubFetch(() => {
      throw new Error('the model must not be called')
    }, { wikipedia: stalled, hn: stalled, web: stalled, arxiv: stalled })

    const res = await handler(request(VALID_BODY, { signal: leave.signal }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    leave.abort()
    const events = await frames(res)

    expect(events.map(event => event.type)).toEqual(['retrieve_start'])
    expect(providerCalls(fetchMock)).toHaveLength(0)
    expect(fetchMock.mock.calls.every(call => call[1]?.signal?.aborted)).toBe(true)
  })

  it('drops a marker that points past the retrieved list and keeps the valid ones', async () => {
    plan({
      researcher: reply('- A [1]. B [9].', 0.1, 10, 10),
      analyst: reply('- C [2, 8].', 0.1, 10, 10),
      critic: reply('- D [2].', 0.1, 10, 10),
      synthesizer: reply('E [1][5].', 0.1, 10, 10),
    })
    const events = await frames(await handler(request(VALID_BODY)))
    const chunks = events.filter(event => event.type === 'agent_chunk').map(event => event.content)
    // The fixture retrieves two sources (one Hacker News, one Wikipedia).
    expect(chunks.slice(0, 3)).toEqual(['- A [1]. B.', '- C [2].', '- D [2].'])
    expect(chunks[3]).toMatch(/^E \[1\]\.\n\n### Sources/)
  })
})
