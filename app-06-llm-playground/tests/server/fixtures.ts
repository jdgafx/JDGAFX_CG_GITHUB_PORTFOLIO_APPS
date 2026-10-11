import { stubFetch } from '../helpers'

export const ORIGIN = 'http://localhost:5173'

// Two live text models, with the prices the server turns into cost estimates.
export const LIVE_CATALOGUE = {
  data: [
    {
      id: 'google/gemini-2.5-flash-lite',
      name: 'Gemini 2.5 Flash Lite',
      context_length: 1_000_000,
      pricing: { prompt: '0.0000001', completion: '0.0000005' },
      architecture: { output_modalities: ['text'] },
    },
    {
      id: 'anthropic/claude-sonnet-5',
      name: 'Claude Sonnet 5',
      context_length: 200_000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
      architecture: { output_modalities: ['text'] },
    },
  ],
}

// The same list with the Haiku alias entry the newest-model check reads: the alias resolves to 5.5 today.
// The catalogue and the newest-model check both read this list, so the alias also shows in the picker.
export const NEWEST_CATALOGUE = {
  data: [
    ...LIVE_CATALOGUE.data,
    {
      id: '~anthropic/claude-haiku-latest',
      name: 'Claude Haiku (latest)',
      context_length: 200_000,
      pricing: { prompt: '0.000001', completion: '0.000005' },
      architecture: { output_modalities: ['text'] },
      alias_target: { slug: 'anthropic/claude-haiku-5.5' },
    },
  ],
}

interface ReplyOptions {
  prompt?: number
  completion?: number
  cost?: number
  finish?: string
}

// A chat reply in OpenRouter's shape, with the usage block the server reads.
export function reply(served: string, text: string, options: ReplyOptions = {}): Response {
  const prompt = options.prompt ?? 10
  const completion = options.completion ?? 3
  return Response.json({
    model: served,
    choices: [{ message: { content: text }, finish_reason: options.finish ?? 'stop' }],
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, cost: options.cost },
  })
}

type ChatHandler = (model: string, init: RequestInit | undefined) => Response | Promise<Response>

// Every fetch a smoke test makes goes through this stub. The catalogue URL gets the catalogue,
// and each chat call goes to the test's handler, keyed by the model it asked for.
export function providerStub(chat: ChatHandler, catalogue?: () => Response | Promise<Response>) {
  return stubFetch(async (url, init) => {
    if (url.endsWith('/models')) return catalogue ? catalogue() : Response.json(LIVE_CATALOGUE)
    const sent = JSON.parse(String(init?.body)) as { model: string }
    return chat(sent.model, init)
  })
}

// The request a browser would send. A GET carries no body.
export function request(
  url: string,
  method: 'GET' | 'POST',
  body?: unknown,
  options: { raw?: string; signal?: AbortSignal } = {},
): Request {
  if (method === 'GET') return new Request(url, { method, headers: { origin: ORIGIN } })
  return new Request(url, {
    method,
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: options.raw ?? JSON.stringify(body),
    signal: options.signal,
  })
}

// The provider calls a stub saw, without the catalogue fetch and the newest-model list fetch (both read the same URL).
export function chatCalls(stub: { mock: { calls: [string, RequestInit?][] } }): [string, RequestInit?][] {
  return stub.mock.calls.filter(([url]) => url.endsWith('/chat/completions'))
}

// The JSON body the server sent to a provider.
export function sentBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}
