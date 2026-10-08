import { vi } from 'vitest'
import { DECIDE_PROMPT, INTAKE_PROMPT, REPLY_PROMPT } from '../../netlify/shared/nodes'
import { defaultExtraction } from './fake-chat'

export interface FakeProviderOptions {
  /** Answer every call with this HTTP status and a raw body, to test the error mapping. */
  status?: number
  extraction?: (ticket: string) => string
  rationale?: string
  email?: string
}

/**
 * The OpenRouter endpoint, faked at the fetch level. Each reply names the model, carries usage,
 * and answers by the role in the system prompt. The intake call reports a cost, and the others do not.
 */
export function providerFetch(options: FakeProviderOptions = {}) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    if (options.status !== undefined && options.status !== 200) {
      return new Response('{"error":"raw provider text that must never reach the browser"}', { status: options.status })
    }
    const body = JSON.parse(String(init.body)) as { model: string; messages: Array<{ role: string; content: string }> }
    const system = body.messages[0]?.content ?? ''
    const user = body.messages.find((message) => message.role === 'user')?.content ?? ''
    let content: string
    let cost: number | undefined
    if (system === INTAKE_PROMPT) {
      content = (options.extraction ?? defaultExtraction)(user)
      cost = 0.000001
    } else if (system === DECIDE_PROMPT) {
      content = JSON.stringify({ rationale: options.rationale ?? 'Two charges were found on the order.' })
    } else if (system === REPLY_PROMPT) {
      content = options.email ?? 'Dear customer, we have reviewed your ticket.'
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
