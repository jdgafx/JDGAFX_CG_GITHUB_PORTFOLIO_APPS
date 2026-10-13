import type { ChatMessage } from './provider'

/** The sentence every model call ends its system prompt with: the date on the server's clock, never the model's guess. */
export function todayLine(now: Date): string {
  return `Today's date is ${now.toISOString().slice(0, 10)}.`
}

/** The same messages with the date added to the system prompt, so a question about "now" or a year is answered from the clock. */
export function withToday(messages: ChatMessage[], now: Date): ChatMessage[] {
  return messages.map(message => (message.role === 'system' ? { ...message, content: `${message.content} ${todayLine(now)}` } : message))
}
