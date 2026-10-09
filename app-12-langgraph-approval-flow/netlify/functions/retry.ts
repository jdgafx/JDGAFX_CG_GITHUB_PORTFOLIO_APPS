import { RunBudget } from '../shared/budget'
import { checkRequest, clientKey, fail, isRecord, rateLimit, readJsonBody, SERVER_ERROR, threadIdFrom } from '../shared/guard'
import { chat, PROVIDER_NOT_CONFIGURED } from '../shared/openrouter'
import { hasStepToRetry, retryRun } from '../shared/run'
import { streamResponse } from '../shared/sse'
import { activeStore, guardStore, storeTimeoutOf } from '../shared/store'
import { getThreadEntry } from '../shared/thread-index'

const NOT_FAILED = 'This thread did not fail, so there is nothing to retry.'
const NOTHING_SAVED = 'This thread has no saved step to continue from. Start the issue again.'
const BUSY = 'This thread is already being retried. Wait for that run to finish.'

/** Threads retried by this function instance. One instance only, like the resume guard. */
const retrying = new Set<string>()

/**
 * POST /api/retry: continues a failed thread from its last checkpoint. Steps that finished, the
 * classification and a maintainer's answer included, are read from the checkpoint and not run again.
 */
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

    const { store, kind } = activeStore()
    const deps = { store, storage: kind, chat, now: () => new Date() }
    if (retrying.has(threadId)) return fail(BUSY, 409)
    const entry = await getThreadEntry(guardStore(store, budget.signal), threadId)
    if (!entry || entry.status !== 'failed') return fail(NOT_FAILED, 409)
    if (!(await hasStepToRetry(deps, threadId, budget.signal))) return fail(NOTHING_SAVED, 409)

    retrying.add(threadId)
    streaming = true
    return streamResponse(budget, (send, signal) =>
      retryRun(deps, { threadId, entry, budget: signal, send }).finally(() => retrying.delete(threadId)),
    )
  } catch (err) {
    const timeout = storeTimeoutOf(err)
    if (timeout) return fail(timeout.message, 503)
    console.error('GraphGate: unexpected retry error', err)
    return fail(SERVER_ERROR, 500)
  } finally {
    if (!streaming) budget.dispose()
  }
}

export const config = {
  path: '/api/retry',
}
