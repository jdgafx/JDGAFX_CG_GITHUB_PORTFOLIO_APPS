import { castBallot, dropRun, loadRun, planBallot, revealed } from '../shared/arena'
import { type VoteResponse } from '../shared/contract'
import { gate, json, readJson, SERVER_ERROR } from '../shared/guard'
import { errorName } from '../shared/parse'
import { activeStore, guardStore, storeTimeoutOf, STORE_SLOW } from '../shared/store'
import { parseVote } from '../shared/validate'

export const config = { path: '/api/vote' }

// A vote body is a run id and a choice.
const VOTE_BODY_MAX_BYTES = 1_024

const GONE = 'This comparison has expired, or it was already voted on. Run it again to vote.'
const BUSY = 'The leaderboard is busy. Your vote was not counted. Press the button again.'

export default async (req: Request): Promise<Response> => {
  const guard = gate(req, 'POST')
  if (!guard.ok) return guard.response
  try {
    const body = await readJson(req, VOTE_BODY_MAX_BYTES)
    if (!body.ok) return json({ error: body.error }, 400, guard.headers)
    const parsed = parseVote(body.value)
    if (!parsed.ok) return json({ error: parsed.error }, 400, guard.headers)
    const { runId, choice } = parsed.value

    const open = activeStore()
    const store = guardStore(open.store, req.signal)
    const found = await loadRun(store, runId)
    if (!found.ok) return json({ error: GONE }, 410, guard.headers)
    const plan = planBallot(found.run, choice)
    if (!plan.ok) return json({ error: plan.error }, 400, guard.headers)

    const cast = await castBallot(store, open.kind, {
      runId,
      entries: plan.entries,
      outcome: plan.outcome,
      tie: plan.tie,
    })
    if (cast.kind === 'duplicate') return json({ error: GONE }, 409, guard.headers)
    if (cast.kind === 'busy') return json({ error: BUSY }, 503, guard.headers)
    // The ballot is counted. Dropping the run is housekeeping: the leaderboard already refuses a second vote.
    await dropRun(store, runId).catch(() => undefined)

    const response: VoteResponse = {
      ok: true,
      choice,
      compare: revealed(found.run.compare, found.run.order),
      changes: cast.changes,
      leaderboard: cast.board,
    }
    return json(response, 200, guard.headers)
  } catch (err) {
    if (storeTimeoutOf(err)) return json({ error: STORE_SLOW }, 503, guard.headers)
    console.error(`Vote failed: ${errorName(err)}`)
    return json({ error: SERVER_ERROR }, 500, guard.headers)
  }
}

