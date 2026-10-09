import { vi } from 'vitest'
import { CLASSIFY_PROMPT } from '../../netlify/shared/classify'
import { MODEL } from '../../netlify/shared/models'
import { REPLY_PROMPT } from '../../netlify/shared/nodes'
import type { ChatFn, ChatRequest, ChatResult } from '../../netlify/shared/openrouter'
import type { Classification } from '../../src/types'
import { CLASSIFIED_QUESTION } from './issues'

export interface FakeChatOptions {
  /** What the classify call returns: the classification as an object, or the raw text. Defaults to a clear question. */
  classification?: Partial<Classification> | string
  email?: string
}

/** A provider reply as the chat function returns it. Cost is not reported unless a test sets it. */
export function providerResult(
  text: string,
  model: string,
  usage: ChatResult['usage'] = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
): ChatResult {
  return { text, finishReason: 'stop', servedModel: model, usage }
}

export function classificationText(option: FakeChatOptions['classification']): string {
  return typeof option === 'string' ? option : JSON.stringify({ ...CLASSIFIED_QUESTION, ...option })
}

/**
 * A chat function that answers by role: classify returns the classification JSON, and reply returns
 * the draft. Every call is recorded for the tests to inspect.
 */
export function fakeChat(options: FakeChatOptions = {}) {
  return vi.fn<ChatFn>(async (request: ChatRequest) => {
    const system = request.messages[0]?.content
    if (request.model === MODEL && system === CLASSIFY_PROMPT) {
      return providerResult(classificationText(options.classification), request.model)
    }
    if (request.model === MODEL && system === REPLY_PROMPT) {
      return providerResult(options.email ?? 'Thanks for the report. We have triaged this issue.', request.model)
    }
    throw new Error(`fakeChat has no answer for model ${request.model}`)
  })
}
