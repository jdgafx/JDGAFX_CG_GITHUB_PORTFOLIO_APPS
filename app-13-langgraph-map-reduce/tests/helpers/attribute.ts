import { MODEL } from '../../netlify/shared/models'
import type { ChatFn, ChatReply } from '../../netlify/shared/openrouter'
import { isAttribute } from './roles'

/**
 * A scripted attribution call. The test texts name their chunk ("Rule 2 holds.", "Chunk 2 rule."), so a sentence that
 * contains the number N states the first key point of chunk N ("N.1"), and nothing else is stated.
 */
export function attributionText(user: string): string {
  const chunk = /Key points of chunk (\d+):/.exec(user)?.[1] ?? '0'
  const states = [...user.matchAll(/^(\d+)\. (.*)$/gm)]
    .filter((m) => new RegExp(`\\b${chunk}\\b`).test(m[2] ?? ''))
    .map((m) => ({ sentence: Number(m[1]), points: [`${chunk}.1`] }))
  return JSON.stringify({ states })
}

export const attributionReply = (user: string): ChatReply => ({
  text: attributionText(user),
  finishReason: 'stop',
  servedModel: MODEL,
  usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
})

/** Answers the attribution calls itself and passes every other call to the test's own script. */
export const withAttribution =
  (inner: ChatFn): ChatFn =>
  (request, signal) =>
    isAttribute(request) ? Promise.resolve(attributionReply(request.messages[request.messages.length - 1]?.content ?? '')) : inner(request, signal)
