import { vi } from 'vitest'
import { CLASSIFY_PROMPT } from '../../netlify/shared/classify'
import { MODEL } from '../../netlify/shared/models'
import { MODEL_LIST_URL } from '../../netlify/shared/newest-model'
import { REPLY_PROMPT } from '../../netlify/shared/nodes'
import { classificationText, NEWEST_HAIKU, type FakeChatOptions } from './fake-chat'

export interface FakeProviderOptions extends FakeChatOptions {
  /** Items the GitHub issue search returns. None by default, so the duplicate check finds nothing. */
  searchItems?: unknown[]
  /** Answer every call with this HTTP status and a raw body, to test the error mapping. */
  status?: number
}

/**
 * The OpenRouter endpoint, faked at the fetch level. Each reply names the model, carries usage,
 * and answers by the role in the system prompt. The classify call reports a cost, and the others do not.
 */
export function providerFetch(options: FakeProviderOptions = {}) {
  return vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).startsWith('https://api.github.com/search/issues')) return Response.json({ items: options.searchItems ?? [] })
    if (String(url) === MODEL_LIST_URL) return Response.json({ data: [{ id: MODEL, alias_target: { slug: NEWEST_HAIKU } }] })
    if (options.status !== undefined && options.status !== 200) {
      return new Response('{"error":"raw provider text that must never reach the browser"}', { status: options.status })
    }
    const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> }
    const system = body.messages[0]?.content ?? ''
    let content: string
    let cost: number | undefined
    if (system?.startsWith(CLASSIFY_PROMPT)) {
      content = classificationText(options.classification)
      cost = 0.000001
    } else if (system?.startsWith(REPLY_PROMPT)) {
      content = options.email ?? 'Thanks for the report. We have triaged this issue.'
    } else {
      return new Response('{}', { status: 400 })
    }
    return Response.json({
      model: NEWEST_HAIKU,
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, ...(cost !== undefined ? { cost } : {}) },
    })
  })
}

/** The fetch calls except the newest-model list read, whose count depends on the instance cache. */
export function callsExceptList(fetchStub: { mock: { calls: Array<[string, RequestInit]> } }): Array<[string, RequestInit]> {
  return fetchStub.mock.calls.filter(([url]) => url !== MODEL_LIST_URL)
}
