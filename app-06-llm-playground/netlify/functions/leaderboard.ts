import { readBoard } from '../shared/arena'
import { LEADERBOARD_BUDGET_MS } from '../shared/contract'
import { budgetSignal } from '../shared/deadline'
import { gate, json, SERVER_ERROR } from '../shared/guard'
import { errorName } from '../shared/parse'
import { activeStore, guardStore, storeTimeoutOf, STORE_SLOW } from '../shared/store'

export const config = { path: '/api/leaderboard' }

export default async (req: Request): Promise<Response> => {
  const guard = gate(req, 'GET')
  if (!guard.ok) return guard.response
  // The read lists the ballots, then reads them in batches in turn, so its time grows with the votes: one budget caps it.
  const budget = budgetSignal(LEADERBOARD_BUDGET_MS, req.signal)
  try {
    const open = activeStore()
    return json(await readBoard(guardStore(open.store, budget.signal), open.kind), 200, guard.headers)
  } catch (err) {
    if (storeTimeoutOf(err)) return json({ error: STORE_SLOW }, 503, guard.headers)
    console.error(`Leaderboard read failed: ${errorName(err)}`)
    return json({ error: SERVER_ERROR }, 500, guard.headers)
  } finally {
    budget.release()
  }
}
