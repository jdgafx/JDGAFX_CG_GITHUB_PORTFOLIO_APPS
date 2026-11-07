import { afterEach, beforeEach, expect, vi } from 'vitest'
import { MODEL_LIST_URL } from '../../netlify/shared/newest-model'

export const SITE = 'https://site.example'
export const ENDPOINT = `${SITE}/api/ai`
export const KEY = 'test-only-placeholder'
export const WEB_KEY = 'test-only-web-placeholder'
export const SERVED = 'anthropic/claude-haiku-5.5'
export const FIXED_MODEL = '~anthropic/claude-haiku-latest'
/** The list names the alias's newest target as SERVED, so replies that name SERVED are 'match'. */
export const MODEL_LIST_BODY = { data: [{ id: FIXED_MODEL, name: 'Claude Haiku latest', alias_target: { slug: SERVED } }] }
export const QUERY = 'In two sentences, compare SSE and WebSockets for streaming LLM output.'
export const VALID_BODY = JSON.stringify({ query: QUERY })
export const PROVIDER_REJECTED = 'The AI provider rejected the key or is out of credit.'
export const PROVIDER_TIMEOUT = 'The AI provider did not answer in time.'

export type Stage = 'researcher' | 'analyst' | 'critic' | 'synthesizer'
export type Frame = Record<string, unknown>


let requestCount = 0

/** Registers the per-test setup: a placeholder key, and a fetch that fails loudly if a test did not plan a call. */
export function installHarness(): void {
  let savedKey: string | undefined
  let savedWebKey: string | undefined
  beforeEach(() => {
    savedKey = process.env.OPENROUTER_API_KEY
    savedWebKey = process.env.TAVILY_API_KEY
    process.env.OPENROUTER_API_KEY = KEY
    process.env.TAVILY_API_KEY = WEB_KEY
    // A call that no test planned fails loudly instead of reaching the network.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('unplanned provider call')
      }),
    )
  })

  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = savedKey
    if (savedWebKey === undefined) delete process.env.TAVILY_API_KEY
    else process.env.TAVILY_API_KEY = savedWebKey
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
}

/** A request from a fresh client address, so the per-address rate limit never interferes. */
export function request(
  body: string | undefined,
  options: { method?: string; origin?: string; ip?: string; signal?: AbortSignal; url?: string } = {},
): Request {
  requestCount += 1
  return new Request(options.url ?? ENDPOINT, {
    method: options.method ?? 'POST',
    body: options.method === 'GET' ? undefined : body,
    signal: options.signal,
    headers: {
      'content-type': 'application/json',
      origin: options.origin ?? SITE,
      'x-forwarded-host': 'site.example',
      'x-nf-client-connection-ip': options.ip ?? `198.51.100.${(requestCount % 250) + 1}`,
    },
  })
}

/** A reply body that sends nothing until its call is aborted, as a stalled connection would. */
export function stalledBody(init: RequestInit | undefined): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
    },
  })
}

/** A reply that streams its text and then ends without a finish reason. */
export function unfinishedReply(text: string): () => Response {
  return () =>
    new Response(`data: ${JSON.stringify({ model: SERVED, choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
}

/** Reads the whole SSE body and returns its frames. The end marker must be the last line. */
export async function frames(response: Response): Promise<Frame[]> {
  const text = await response.text()
  expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true)
  return text
    .split('\n\n')
    .map(block => block.trim())
    .filter(block => block.startsWith('data: ') && block !== 'data: [DONE]')
    .map(block => JSON.parse(block.slice(6)) as Frame)
}

export function stageOf(systemPrompt: string | undefined): Stage {
  if (systemPrompt?.startsWith('You are a research assistant')) return 'researcher'
  if (systemPrompt?.startsWith('You are an analyst')) return 'analyst'
  if (systemPrompt?.startsWith('You are a critic')) return 'critic'
  if (systemPrompt?.startsWith('You are a synthesis agent')) return 'synthesizer'
  throw new Error('unknown stage prompt')
}

export const WIKIPEDIA_HOST = 'https://en.wikipedia.org/'
export const HN_HOST = 'https://hn.algolia.com/'
export const ARXIV_HOST = 'https://export.arxiv.org/'
export const WEB_HOST = 'https://api.tavily.com/'

// Recorded shapes of the public APIs. The app itself fetches them live. Each page carries enough of the QUERY's topic words to pass the relevance rule.
export const WIKIPEDIA_BODY = {
  query: {
    pages: [
      { title: 'Server-sent events', index: 1, extract: 'Server-sent events (SSE) is a technology where a browser receives automatic updates from a server via HTTP, suited to streaming LLM output.' },
      { title: 'WebSocket', index: 2, extract: 'WebSocket is a computer communications protocol providing full-duplex channels over a single TCP connection, used for streaming output.' },
    ],
  },
}
export const HN_BODY = {
  hits: [
    {
      objectID: '31010000',
      title: 'Server-sent events vs WebSockets for streaming LLM output',
      url: 'https://example.com/sse',
      points: 210,
      num_comments: 88,
      created_at: '2022-04-02T10:00:00Z',
    },
  ],
}

export const EMPTY_FEED = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>ArXiv Query</title></feed>'

export type PublicReply = (init?: RequestInit) => Response | Promise<Response>

/** The replies of the public sources. A web or arXiv reply left out answers with nothing found. */
export interface Retrieval {
  wikipedia: PublicReply
  hn: PublicReply
  web?: PublicReply
  arxiv?: PublicReply
  /** The relevance call at the end of Retrieve. Left out, it marks every candidate relevant. */
  judge?: PublicReply
}

export const jsonReply = (body: unknown, status = 200): PublicReply => () => new Response(JSON.stringify(body), { status })
export const GOOD_RETRIEVAL: Retrieval = { wikipedia: jsonReply(WIKIPEDIA_BODY), hn: jsonReply(HN_BODY) }

/** A call to one of the public sources, or undefined for a provider call. */
export function retrievalCall(url: string, retrieval: Retrieval, init?: RequestInit): Response | Promise<Response> | undefined {
  if (url.startsWith(WIKIPEDIA_HOST)) return retrieval.wikipedia(init)
  if (url.startsWith(HN_HOST)) return retrieval.hn(init)
  if (url.startsWith(WEB_HOST)) return (retrieval.web ?? jsonReply({ results: [] }))(init)
  if (url.startsWith(ARXIV_HOST)) return (retrieval.arxiv ?? (() => new Response(EMPTY_FEED, { status: 200 })))(init)
  if (url === MODEL_LIST_URL) return jsonReply(MODEL_LIST_BODY)()
  return undefined
}

/** The relevance call at the end of Retrieve is a provider call; it is told apart from the four stages by its system prompt. */
export function isRelevanceCall(init: RequestInit | undefined): boolean {
  try {
    const sent = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> }
    return sent.messages?.[0]?.content?.startsWith('You decide which search results') === true
  } catch {
    return false
  }
}

/** The default relevance reply: every candidate shown is relevant. */
function keepEvery(init: RequestInit | undefined): Response {
  const sent = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
  const shown = (sent.messages[1]?.content.match(/^\d+\. \[/gm) ?? []).length
  return reply(JSON.stringify({ results: Array.from({ length: shown }, (_, i) => ({ n: i + 1, relevant: true })) }), 0.0002, 600, 100)()
}

/** Routes the public-source calls to a fixture, the relevance call to its fixture, and every other call to the given provider handler. */
export function stubFetch(provider: (...args: Parameters<typeof fetch>) => Response | Promise<Response>, retrieval = GOOD_RETRIEVAL) {
  const fetchMock = vi.fn<typeof fetch>(async (...args) => {
    const call = retrievalCall(String(args[0]), retrieval, args[1])
    if (call) return call
    if (isRelevanceCall(args[1])) return retrieval.judge ? retrieval.judge(args[1]) : keepEvery(args[1])
    return provider(...args)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The calls that went to the model provider for a stage or the audit, not to a public source, the model list or the relevance check. */
export function providerCalls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(call => {
    const url = String(call[0])
    return ![WIKIPEDIA_HOST, HN_HOST, WEB_HOST, ARXIV_HOST].some(host => url.startsWith(host)) && url !== MODEL_LIST_URL && !isRelevanceCall(call[1])
  })
}

/** The relevance calls of Retrieve. */
export function relevanceCalls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(call => isRelevanceCall(call[1]))
}

/** Routes each provider call to the reply planned for its stage, judged from the system prompt sent. */
export function plan(replies: Record<Stage, () => Response>, retrieval = GOOD_RETRIEVAL) {
  return stubFetch((_input, init) => {
    const sent = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
    return replies[stageOf(sent.messages[0]?.content)]()
  }, retrieval)
}

export function reply(text: string, cost: number, prompt: number, completion: number, model = SERVED): () => Response {
  return () => {
    const body =
      [
        { model, choices: [{ delta: { content: text } }] },
        {
          model,
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, cost },
        },
      ]
        .map(value => `data: ${JSON.stringify(value)}\n\n`)
        .join('') + 'data: [DONE]\n\n'
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
}

/** A reply that streams its text and then ends with finish_reason 'length': the text may still look like a complete answer. */
export function lengthReply(text: string): () => Response {
  return () =>
    new Response(
      [
        { model: SERVED, choices: [{ delta: { content: text } }] },
        { model: SERVED, choices: [{ delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 4000, total_tokens: 4010, cost: 0.001 } },
      ]
        .map(value => `data: ${JSON.stringify(value)}\n\n`)
        .join('') + 'data: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
}

/** A reply whose frames name no model, so its served model is not reported. */
export function unnamedReply(text: string): () => Response {
  return () =>
    new Response(
      [{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]
        .map(value => `data: ${JSON.stringify(value)}\n\n`)
        .join('') + 'data: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
}

export function refuse(status: number, body: string): () => Response {
  return () => new Response(body, { status })
}

export function errorsOf(events: Frame[]): unknown[] {
  return events.filter(event => event.type === 'agent_error').map(event => event.error)
}

