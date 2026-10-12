import { searchIssues } from '../shared/github-search'
import { PRE_STREAM_RELEASE_CALL_MS, RunBudget } from '../shared/budget'
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
import { newestModel } from '../shared/newest-model'
import { claimThread, releaseClaim, THREAD_BUSY, type Claim } from '../shared/claim'
import { inspectThread, resumeRun } from '../shared/run'
import { streamResponse } from '../shared/sse'
import { activeStore, guardStore, storeTimeoutOf } from '../shared/store'
import { labelsProblem } from '../shared/triage'

const NOT_AWAITING = 'This thread is not awaiting approval.'

/** POST /api/resume: continues a paused thread from its checkpoint with the maintainer's answer. */
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
    if (!process.env.OPENROUTER_API_KEY) return fail(PROVIDER_NOT_CONFIGURED, 503)

    const body = await readJsonBody(req)
    if (!body.ok) return body.response
    const threadId = threadIdFrom(isRecord(body.value) ? body.value.threadId : undefined)
    if (!threadId) return fail('The thread id is not valid.', 400)
    const decision = decisionFrom(body.value)
    if (!decision.ok) return fail(decision.message, 400)

    const { store, kind } = opened
    const deps = { store, storage: kind, chat, search: searchIssues, now: () => new Date(), newestModel }
    // The work before the stream shares the pre-stream time, so a hung store cannot hold the request past the page's wait.
    const before = budget.preStreamSignal
    // One run at a time per thread, across function instances. The loser is told so, and nothing runs twice.
    claim = await claimThread(guardStore(store, before), threadId)
    if (!claim) return fail(THREAD_BUSY, 409)
    // The checkpoint decides whether the thread is waiting, whatever its summary says.
    const info = await inspectThread(deps, threadId, before, { ownsClaim: true })
    if (!info?.proposal) return fail(NOT_AWAITING, 409)
    const review = info.proposal
    const entry = info.entry

    const answer = decision.value
    // An edit may only use labels from the list the card offered, so a crafted request cannot invent one.
    if (answer.action === 'edit') {
      const problem = labelsProblem(answer.labels ?? [], review.triage.labels)
      if (problem) return fail(problem, 400)
    }

    streaming = true
    const held = claim
    // The claim is freed under the request's closing signal, so the last writes end with the closing grace.
    const free = () => releaseClaim(guardStore(store, budget.closeSignal), held)
    return streamResponse(budget, (send, signal, closeBy) =>
      resumeRun(deps, { threadId, entry, answer, budget: signal, remainingMs: () => budget.remainingMs(), release: free, closeBy, send }).finally(free),
    )
  } catch (err) {
    const timeout = storeTimeoutOf(err)
    if (timeout) return fail(timeout.message, 503)
    console.error('GraphGate: unexpected resume error', err)
    return fail(SERVER_ERROR, 500)
  } finally {
    if (!streaming) {
      budget.dispose()
      if (claim) await releaseClaim(guardStore(opened.store, undefined, PRE_STREAM_RELEASE_CALL_MS), claim)
    }
  }
}

export const config = {
  path: '/api/resume',
}
