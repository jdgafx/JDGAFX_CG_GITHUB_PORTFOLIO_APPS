// What the conversation sends back to the server as earlier messages. A question that got
// no answer (the request failed, was cancelled or was refused) stays in the log, marked as
// not sent, and is left out of the history, so the next question is not answered together
// with it.
import type { ChatMessage, Message } from './api'

// Matches the history limit the chat function accepts.
export const MAX_HISTORY_MESSAGES = 20

export function historyFor(messages: ChatMessage[]): Message[] {
  return messages
    .filter(message => message.unsent === undefined)
    .slice(-MAX_HISTORY_MESSAGES)
    .map(({ role, content }) => ({ role, content }))
}

export function markUnsent(messages: ChatMessage[], id: string, reason: string): ChatMessage[] {
  return messages.map(message => (message.id === id ? { ...message, unsent: reason } : message))
}

// The longest typed question. The server accepts more; this keeps a typed question small.
export const MAX_QUESTION_CHARS = 2000

// The refusal for a typed question over the limit, or null when it fits. It reads like
// the server's own copy for its limit.
export function tooLongMessage(text: string): string | null {
  const length = text.trim().length
  return length > MAX_QUESTION_CHARS
    ? `Keep messages under ${MAX_QUESTION_CHARS} characters. This one has ${length.toLocaleString('en-US')}.`
    : null
}
