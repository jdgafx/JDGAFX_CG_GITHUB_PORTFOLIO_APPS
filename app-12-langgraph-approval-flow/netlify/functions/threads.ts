import { checkRequest, fail, json } from '../shared/guard'
import { activeStore, guardStore, MEMORY_NOTICE, storeTimeoutOf } from '../shared/store'
import { chat } from '../shared/openrouter'
import { repairStaleRows } from '../shared/run'
import { describeError, listThreadsDetailed } from '../shared/thread-index'

/** GET /api/threads: the thread list, waiting first and then newest, and where checkpoints are kept. */
export default async (req: Request): Promise<Response> => {
  try {
    const refused = checkRequest(req, 'GET')
    if (refused) return refused
    const { store, kind } = activeStore()
    // Reads of many summaries get a shorter limit each, so one slow read cannot hold the whole list.
    const guarded = guardStore(store, undefined, 4_000)
    const { rows, stale } = await listThreadsDetailed(guarded)
    // A row that says waiting without a waiting marker is checked against its checkpoint (a few per call).
    const threads = stale.length > 0 ? await repairStaleRows({ store: guarded, storage: kind, chat, now: () => new Date() }, rows, stale) : rows
    return json({ success: true, storage: kind, notice: kind === 'memory' ? MEMORY_NOTICE : null, threads }, 200)
  } catch (err) {
    const timeout = storeTimeoutOf(err)
    if (timeout) return fail(timeout.message, 503)
    console.error(`GraphGate: could not read the thread list: ${describeError(err)}`)
    return fail('The saved threads could not be read right now. Try again in a moment.', 503)
  }
}

export const config = {
  path: '/api/threads',
}
