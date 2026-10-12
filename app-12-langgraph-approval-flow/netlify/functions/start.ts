import { searchIssues } from '../shared/github-search'
import { PRE_STREAM_RELEASE_CALL_MS, RunBudget } from '../shared/budget'
import { checkRequest, clientKey, fail, rateLimit, readJsonBody, SERVER_ERROR } from '../shared/guard'
import { issueFrom } from '../shared/issue-input'
import { chat, PROVIDER_NOT_CONFIGURED } from '../shared/openrouter'
import { newestModel } from '../shared/newest-model'
import { startRun } from '../shared/run'
import { streamResponse } from '../shared/sse'
import { claimThread, releaseClaim, type Claim } from '../shared/claim'
import { activeStore, guardStore, storeTimeoutOf } from '../shared/store'
import { newThreadId } from '../shared/thread-index'

/** POST /api/start: triages one GitHub issue and streams its frames until the review pause or the result. */
export default async (req: Request): Promise<Response> => {
  const budget = new RunBudget()
  let streaming = false
  let claim: Claim | null = null
  // One store for the whole request, made when the request arrives (see activeStore).
  const opened = activeStore()
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

    const { store, kind } = opened
    const threadId = newThreadId()
    // The new thread is claimed while its first run goes, so opening it meanwhile reads as running, not failed.
    // The claim shares the pre-stream time, so a slow store refuses the request before the page stops waiting.
    claim = await claimThread(guardStore(store, budget.preStreamSignal), threadId)
    streaming = true
    const held = claim
    // The claim is freed under the request's closing signal, so the last writes end with the closing grace.
    const free = () => (held ? releaseClaim(guardStore(store, budget.closeSignal), held) : Promise.resolve())
    return streamResponse(budget, (send, signal, closeBy) =>
      startRun(
        { store, storage: kind, chat, search: searchIssues, now: () => new Date(), newestModel },
        { issue: issue.value, threadId, budget: signal, remainingMs: () => budget.remainingMs(), release: free, closeBy, send },
      ).finally(free),
    )
  } catch (err) {
    const timeout = storeTimeoutOf(err)
    if (timeout) return fail(timeout.message, 503)
    console.error('GraphGate: unexpected start error', err)
    return fail(SERVER_ERROR, 500)
  } finally {
    // A refused request never reaches the stream, so its budget timer is cleared here and its claim freed within the pre-stream release time.
    if (!streaming) {
      budget.dispose()
      if (claim) await releaseClaim(guardStore(opened.store, undefined, PRE_STREAM_RELEASE_CALL_MS), claim)
    }
  }
}

export const config = {
  path: '/api/start',
}
