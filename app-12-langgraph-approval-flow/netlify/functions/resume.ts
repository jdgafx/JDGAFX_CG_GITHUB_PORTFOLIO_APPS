import { formatUsd } from '../../src/lib/money'
import { RunBudget } from '../shared/budget'
import {
  checkRequest,
  clientKey,
  decisionFrom,
  fail,
  isRecord,
  rateLimit,
  readJsonBody,
  SERVER_ERROR,
  threadIdFrom,
} from '../shared/guard'
import { chat, PROVIDER_NOT_CONFIGURED } from '../shared/openrouter'
import { pendingReview, resumeRun } from '../shared/run'
import { streamResponse } from '../shared/sse'
import { activeStore, guardStore, storeTimeoutOf } from '../shared/store'
import { getThreadEntry } from '../shared/thread-index'

const NOT_AWAITING = 'This thread is not awaiting approval.'
const BUSY = 'This thread is already being resumed. Wait for that run to finish.'

/**
 * Threads resumed by this function instance. A second answer for the same thread while the first
 * still runs is refused. This guards one instance only, not a race across instances.
 */
const resuming = new Set<string>()

/** POST /api/resume: continues a paused thread from its checkpoint with the human's answer. */
export default async (req: Request): Promise<Response> => {
  const budget = new RunBudget()
  let streaming = false
  try {
    const refused = checkRequest(req, 'POST')
    if (refused) return refused

    const limit = rateLimit(clientKey(req))
    if (!limit.allowed) {
      return fail('Too many requests from this address. Please wait a moment and try again.', 429, {
        'Retry-After': String(limit.retryAfter),
      })
    }
    if (!process.env.OPENROUTER_API_KEY) return fail(PROVIDER_NOT_CONFIGURED, 503)

    const body = await readJsonBody(req)
    if (!body.ok) return body.response
    const threadId = threadIdFrom(isRecord(body.value) ? body.value.threadId : undefined)
    if (!threadId) return fail('The thread id is not valid.', 400)
    const decision = decisionFrom(body.value)
    if (!decision.ok) return fail(decision.message, 400)

    const { store, kind } = activeStore()
    const deps = { store, storage: kind, chat, now: () => new Date() }
    if (resuming.has(threadId)) return fail(BUSY, 409)
    // The reads before the stream share the request budget, so a hung store cannot hold the request.
    const entry = await getThreadEntry(guardStore(store, budget.signal), threadId)
    if (!entry || entry.status !== 'awaiting_approval') return fail(NOT_AWAITING, 409)
    const review = await pendingReview(deps, threadId, budget.signal)
    if (!review) return fail(NOT_AWAITING, 409)

    const answer = decision.value
    // The cap is intended: an edited refund may not exceed what the order cost.
    if (answer.action === 'edit') {
      if (review.orderTotal === null) {
        return fail('No order matches this thread, so the amount cannot be edited. Approve or reject instead.', 400)
      }
      if ((answer.amount ?? 0) > review.orderTotal) {
        return fail(`The amount cannot be more than the order total of ${formatUsd(review.orderTotal)}.`, 400)
      }
    }

    resuming.add(threadId)
    streaming = true
    return streamResponse(budget, (send, signal) =>
      resumeRun(deps, {
        threadId,
        title: entry.title,
        failedAmount: entry.amount,
        answer,
        budget: signal,
        send,
      }).finally(() => resuming.delete(threadId)),
    )
  } catch (err) {
    const timeout = storeTimeoutOf(err)
    if (timeout) return fail(timeout.message, 503)
    console.error('GraphGate: unexpected resume error', err)
    return fail(SERVER_ERROR, 500)
  } finally {
    if (!streaming) budget.dispose()
  }
}

export const config = {
  path: '/api/resume',
}
