import { vi } from 'vitest'
import { DECIDE_MODEL, INTAKE_MODEL, REPLY_MODEL } from '../../netlify/shared/models'
import { DECIDE_PROMPT, INTAKE_PROMPT, REPLY_PROMPT } from '../../netlify/shared/nodes'
import type { ChatFn, ChatRequest, ChatResult } from '../../netlify/shared/openrouter'

export interface FakeChatOptions {
  /** The intake facts for a ticket. Defaults to reading the order id and a keyword from the ticket. */
  extraction?: (ticket: string) => string
  rationale?: string
  email?: string
}

/** A provider reply as the chat function returns it. Cost is not reported unless a test sets it. */
export function providerResult(
  text: string,
  model: string,
  usage: ChatResult['usage'] = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
): ChatResult {
  return { text, toolCalls: [], finishReason: 'stop', servedModel: model, usage }
}

function userText(request: ChatRequest): string {
  return request.messages.find((message) => message.role === 'user')?.content ?? ''
}

export function defaultExtraction(ticket: string): string {
  if (ticket.includes('ORD-1042')) {
    return JSON.stringify({ orderId: 'ORD-1042', issue: 'duplicate_charge', requestedAmount: 129 })
  }
  if (ticket.includes('ORD-1077')) {
    return JSON.stringify({ orderId: 'ORD-1077', issue: 'defective_item', requestedAmount: 24.5 })
  }
  return JSON.stringify({ orderId: null, issue: 'other', requestedAmount: null })
}

/**
 * A chat function that answers by role: intake returns the extraction, decide returns the
 * rationale, and reply returns the email. Every call is recorded for the tests to inspect.
 */
export function fakeChat(options: FakeChatOptions = {}) {
  return vi.fn<ChatFn>(async (request: ChatRequest) => {
    const system = request.messages[0]?.content
    if (request.model === INTAKE_MODEL && system === INTAKE_PROMPT) {
      return providerResult((options.extraction ?? defaultExtraction)(userText(request)), request.model)
    }
    if (request.model === DECIDE_MODEL && system === DECIDE_PROMPT) {
      return providerResult(JSON.stringify({ rationale: options.rationale ?? 'Rationale from the fake model.' }), request.model)
    }
    if (request.model === REPLY_MODEL && system === REPLY_PROMPT) {
      return providerResult(options.email ?? 'Dear customer, here is our reply.', request.model)
    }
    throw new Error(`fakeChat has no answer for model ${request.model}`)
  })
}
