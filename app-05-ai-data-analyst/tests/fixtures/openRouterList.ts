import { MODEL_LIST_URL } from '../../netlify/shared/newest-model'

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

/**
 * OpenRouter's model list. `newest` is the model the requested alias resolves to; null gives a list with no entry
 * for the alias, which is what a list that answers without the newest model looks like.
 */
export function modelListReply(newest: string | null): Response {
  const data =
    newest === null
      ? [{ id: 'anthropic/claude-haiku-5.5', pricing: { prompt: '0.000001', completion: '0.000005' } }]
      : [{ id: '~anthropic/claude-haiku-latest', alias_target: { slug: newest } }]
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/** Answers the model list from `list` and every other URL from `provider`, so the list never takes a queued model reply. */
export function routeFetch(provider: FetchFn, list: FetchFn): FetchFn {
  return (url, init) => (url === MODEL_LIST_URL ? list(url, init) : provider(url, init))
}
