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
import { inFlight, inspectThread, resumeRun } from '../shared/run'
import { streamResponse } from '../shared/sse'
import { activeStore, storeTimeoutOf } from '../shared/store'
import { labelsProblem } from '../shared/triage'

const NOT_AWAITING = 'This thread is not awaiting approval.'
const BUSY = 'This thread is already being resumed. Wait for that run to finish.'

/** POST /api/resume: continues a paused thread from its checkpoint with the maintainer's answer. */
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
    if (inFlight.has(threadId)) return fail(BUSY, 409)
    // The read before the stream shares the request budget, so a hung store cannot hold the request. The
    // checkpoint decides whether the thread is waiting, whatever its summary says.
    const info = await inspectThread(deps, threadId, budget.signal)
    if (!info?.proposal) return fail(NOT_AWAITING, 409)
    const review = info.proposal
    const entry = info.entry

    const answer = decision.value
    // An edit may only use labels from the list the card offered, so a crafted request cannot invent one.
    if (answer.action === 'edit') {
      const problem = labelsProblem(answer.labels ?? [], review.triage.labels)
      if (problem) return fail(problem, 400)
    }

    inFlight.add(threadId)
    streaming = true
    return streamResponse(budget, (send, signal) =>
      resumeRun(deps, { threadId, entry, answer, budget: signal, remainingMs: () => budget.remainingMs(), send }).finally(() => inFlight.delete(threadId)),
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
