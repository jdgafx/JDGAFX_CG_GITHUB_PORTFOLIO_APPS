import type { NodeName, TraceRow } from '../../src/types/frames'
import { priceCall } from './cost'
import type { ChatReply } from './openrouter'
import { newestModel, servedCheck } from './newest-model'
import type { ModelList } from './prices'

/**
 * A reply that stopped at the token cap is cut off. Its text may still parse, but the tail is lost, so no node
 * reads it: an extract counts the chunk as not extracted, and synthesis ends the run.
 */
export const CUT_OFF_MESSAGE = 'The AI ran out of reply length, so the reply was cut off.'
export const isCutOff = (reply: ChatReply): boolean => reply.finishReason === 'length'

export function traceRow(
  node: NodeName,
  status: TraceRow['status'],
  ms: number,
  detail: string,
  extra: Partial<TraceRow> = {},
): TraceRow {
  return { node, status, ms, detail, ...extra }
}

/**
 * Models, usage, price and model check of one call. The row keeps the requested id and the id that served it; the price
 * and the check are the served model's, never the requested alias's. A mismatch is shown and logged, never refused.
 */
export async function callFields(requested: string, reply: ChatReply, models: Promise<ModelList | null>): Promise<Partial<TraceRow>> {
  const list = await models
  const newest = newestModel(list)
  const check = servedCheck(newest, reply.servedModel)
  if (check === 'mismatch') console.warn(`model mismatch: served ${reply.servedModel}, newest ${newest}, requested ${requested}`)
  return {
    model: requested,
    servedModel: reply.servedModel,
    newestModel: newest,
    modelCheck: check,
    ...(reply.usage ? { usage: reply.usage } : {}),
    ...priceCall(list?.prices ?? null, reply.servedModel, reply.usage),
  }
}
