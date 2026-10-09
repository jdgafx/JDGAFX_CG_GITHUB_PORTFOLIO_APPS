import { vi } from 'vitest'
import { CLASSIFY_PROMPT } from '../../netlify/shared/classify'
import { REPLY_PROMPT } from '../../netlify/shared/nodes'
import { classificationText, type FakeChatOptions } from './fake-chat'

export interface FakeProviderOptions extends FakeChatOptions {
  /** Answer every call with this HTTP status and a raw body, to test the error mapping. */
  status?: number
}

/**
 * The OpenRouter endpoint, faked at the fetch level. Each reply names the model, carries usage,
 * and answers by the role in the system prompt. The classify call reports a cost, and the others do not.
 */
export function providerFetch(options: FakeProviderOptions = {}) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    if (options.status !== undefined && options.status !== 200) {
      return new Response('{"error":"raw provider text that must never reach the browser"}', { status: options.status })
    }
    const body = JSON.parse(String(init.body)) as { model: string; messages: Array<{ role: string; content: string }> }
    const system = body.messages[0]?.content ?? ''
    let content: string
    let cost: number | undefined
    if (system === CLASSIFY_PROMPT) {
      content = classificationText(options.classification)
      cost = 0.000001
    } else if (system === REPLY_PROMPT) {
      content = options.email ?? 'Thanks for the report. We have triaged this issue.'
    } else {
      return new Response('{}', { status: 400 })
    }
    return Response.json({
      model: body.model,
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, ...(cost !== undefined ? { cost } : {}) },
    })
  })
}
