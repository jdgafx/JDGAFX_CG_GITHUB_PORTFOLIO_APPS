import { RunBudget } from '../shared/budget'
import { checkRequest, clientKey, fail, rateLimit, readJsonBody, SERVER_ERROR } from '../shared/guard'
import { issueFrom } from '../shared/issue-input'
import { chat, PROVIDER_NOT_CONFIGURED } from '../shared/openrouter'
import { startRun } from '../shared/run'
import { streamResponse } from '../shared/sse'
import { activeStore } from '../shared/store'
import { newThreadId } from '../shared/thread-index'

/** POST /api/start: triages one GitHub issue and streams its frames until the review pause or the result. */
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
    // Checked before any model call, so a missing key costs nothing.
    if (!process.env.OPENROUTER_API_KEY) return fail(PROVIDER_NOT_CONFIGURED, 503)

    const body = await readJsonBody(req)
    if (!body.ok) return body.response
    const issue = issueFrom(body.value)
    if (!issue.ok) return fail(issue.message, 400)

    const { store, kind } = activeStore()
    const threadId = newThreadId()
    streaming = true
    return streamResponse(budget, (send, signal) =>
      startRun(
        { store, storage: kind, chat, now: () => new Date() },
        { issue: issue.value, threadId, budget: signal, remainingMs: () => budget.remainingMs(), send },
      ),
    )
  } catch (err) {
    console.error('GraphGate: unexpected start error', err)
    return fail(SERVER_ERROR, 500)
  } finally {
    // A refused request never reaches the stream, so its budget timer is cleared here.
    if (!streaming) budget.dispose()
  }
}

export const config = {
  path: '/api/start',
}
