import { readBoard } from '../shared/arena'
import { gate, json, SERVER_ERROR } from '../shared/guard'
import { errorName } from '../shared/parse'
import { activeStore, guardStore, storeTimeoutOf, STORE_SLOW } from '../shared/store'

export const config = { path: '/api/leaderboard' }

export default async (req: Request): Promise<Response> => {
  const guard = gate(req, 'GET')
  if (!guard.ok) return guard.response
  try {
    const open = activeStore()
    return json(await readBoard(guardStore(open.store, req.signal), open.kind), 200, guard.headers)
  } catch (err) {
    if (storeTimeoutOf(err)) return json({ error: STORE_SLOW }, 503, guard.headers)
    console.error(`Leaderboard read failed: ${errorName(err)}`)
    return json({ error: SERVER_ERROR }, 500, guard.headers)
  }
}
