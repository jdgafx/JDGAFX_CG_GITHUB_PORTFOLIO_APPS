import type { Frame, Merged, Summary, TraceRow } from '../../src/types/frames'
import type { Limiter, RunBudget } from './budget'
import { plainMessage, ProviderError } from './errors'
import { ATTRIBUTE, CHECK_BUDGET_MARGIN_MS, MIN_ATTRIBUTE_BUDGET_MS } from './models'
import type { ChatFn, ChatReply } from './openrouter'
import { parseStated } from './parse'
import { attributeMessages } from './prompts'

export interface AttributionDeps {
  chat: ChatFn
  limiter: Limiter
  budget: RunBudget
  /** The longest one call may take, cut to fit what is left of the run budget. */
  timeoutMs: number
  /** Served model, usage, price and model check of one answered call. */
  fields: (reply: ChatReply) => Promise<Partial<TraceRow>>
  emit: (frame: Frame) => void
}

export interface Attribution {
  /** Summary sentence number (1 is the first sentence of the first section) to the key point ids it states. */
  stated: Map<number, string[]>
  /** Chunks whose call did not give a readable answer, or was never made. Their points are not shown to be used. */
  unchecked: number[]
  rows: TraceRow[]
}

/**
 * Which key points the finished summary states, judged one chunk at a time: each call sees the numbered sentences and one
 * chunk's key points, so none can grow into a long deliberation over the whole document. The calls run together. A call
 * that fails, is cut off or cannot be read leaves its chunk unchecked; it never discards the finished summary. With too
 * little of the run budget left no call is made, because a budget that expires inside one would discard it. An ID the
 * model names that is not one of that chunk's points, or a sentence number outside the summary, is dropped.
 */
export async function attribute(deps: AttributionDeps, summary: Summary, merged: Merged): Promise<Attribution> {
  const { chat, limiter, budget, emit } = deps
  const sentences = summary.sections.flatMap((section) => section.points.map((point) => point.text))
  const total = merged.byChunk.length
  const stated = new Map<number, string[]>()
  const unchecked: number[] = []
  const rows: TraceRow[] = []
  const write = (row: TraceRow): void => {
    rows.push(row)
    emit({ type: 'node_end', ...row })
  }

  if (budget.remaining() < MIN_ATTRIBUTE_BUDGET_MS) {
    for (const chunk of merged.byChunk) unchecked.push(chunk.chunkId)
    write({ node: 'check', status: 'failed', ms: 0, detail: 'Key point check skipped: too little of the time limit was left', message: 'Too little of the time limit was left.' })
    return { stated, unchecked, rows }
  }

  const timeoutMs = Math.min(deps.timeoutMs, budget.remaining() - CHECK_BUDGET_MARGIN_MS)
  await Promise.all(
    merged.byChunk.map(async (chunk) => {
      const label = `chunk ${chunk.chunkId} of ${total}`
      const began = Date.now()
      try {
        await limiter.run(async () => {
          emit({ type: 'node_start', node: 'check', ms: budget.elapsed(), detail: label, chunk: chunk.chunkId })
          const reply = await chat({ ...ATTRIBUTE, timeoutMs, messages: attributeMessages(sentences, chunk.chunkId, chunk.points) }, budget.signal)
          const ms = Date.now() - began
          const fields = await deps.fields(reply)
          const result = reply.finishReason === 'length' ? null : parseStated(reply.text, sentences.length, chunk.points.map((p) => p.id))
          if (result === null) {
            unchecked.push(chunk.chunkId)
            write({ node: 'check', status: 'failed', ms, detail: label, chunk: chunk.chunkId, message: reply.finishReason === 'length' ? 'The check reply was cut off.' : 'The check reply was not readable.', ...fields })
            return
          }
          for (const [sentence, ids] of result) stated.set(sentence, [...new Set([...(stated.get(sentence) ?? []), ...ids])])
          write({ node: 'check', status: 'ok', ms, detail: label, chunk: chunk.chunkId, ...fields })
        }, budget.signal)
      } catch (err) {
        // The check is a second opinion about the summary. A failure here never discards a finished summary. The call was made
        // and no reply came, so its row names the model and carries no usage, which the totals count as not reported.
        const lost: TraceRow = { node: 'check', status: 'failed', ms: Date.now() - began, detail: label, chunk: chunk.chunkId, model: ATTRIBUTE.model, message: plainMessage(err, budget.expired()) }
        if (!(err instanceof ProviderError) || budget.expired()) {
          write(lost)
          throw err
        }
        unchecked.push(chunk.chunkId)
        write(lost)
      }
    }),
  )
  unchecked.sort((a, b) => a - b)
  return { stated, unchecked, rows }
}
