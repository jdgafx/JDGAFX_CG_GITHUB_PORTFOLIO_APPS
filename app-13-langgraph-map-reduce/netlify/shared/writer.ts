import type { Frame, Summary, TraceRow } from '../../src/types/frames'
import type { RunBudget } from './budget'
import { plainMessage, RunFailure } from './errors'
import { SYNTH } from './models'
import type { ChatFn, ChatMessage, ChatReply } from './openrouter'
import { parseSummary } from './parse'
import type { ModelList } from './prices'
import { callFields, CUT_OFF_MESSAGE, isCutOff, traceRow } from './rows'

export interface WriterDeps {
  chat: ChatFn
  budget: RunBudget
  models: Promise<ModelList | null>
  timeoutMs: number
  emit: (frame: Frame) => void
}

/**
 * One writer call, for the first summary and for a rewrite alike, with the usage rule applied to every way it can end. A reply
 * that is refused (cut off, not a summary) was still billed, so its row carries the usage and cost before the run fails with
 * the reason. A call that was made and got no reply names its model and carries no usage, which the totals count as not
 * reported. `detail` is the step's label on those failed rows; the caller writes the row of a summary it accepts.
 */
export async function writeSummary(
  deps: WriterDeps,
  messages: ChatMessage[],
  chunkIds: number[],
  detail: string,
): Promise<{ summary: Summary; ms: number; fields: Partial<TraceRow> }> {
  const { chat, budget, models, emit } = deps
  const startedAt = Date.now()
  let reply: ChatReply
  try {
    reply = await chat({ ...SYNTH, timeoutMs: deps.timeoutMs, messages }, budget.signal)
  } catch (err) {
    emit({ type: 'node_end', ...traceRow('synthesize', 'failed', Date.now() - startedAt, detail, { model: SYNTH.model, message: plainMessage(err, budget.expired()) }) })
    throw err
  }
  const ms = Date.now() - startedAt
  const fields = await callFields(SYNTH.model, reply, models)
  const refuse = (message: string): never => {
    emit({ type: 'node_end', ...traceRow('synthesize', 'failed', ms, detail, { ...fields, message }) })
    throw new RunFailure(message)
  }
  if (isCutOff(reply)) return refuse(`${CUT_OFF_MESSAGE} Run the text again.`)
  const summary = parseSummary(reply.text, chunkIds)
  if (!summary) return refuse('The summary could not be read. Run the text again.')
  return { summary, ms, fields }
}
