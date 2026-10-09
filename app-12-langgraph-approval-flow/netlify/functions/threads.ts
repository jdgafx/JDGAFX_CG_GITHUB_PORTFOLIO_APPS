import { checkRequest, fail, json } from '../shared/guard'
import { activeStore, guardStore, MEMORY_NOTICE, storeTimeoutOf } from '../shared/store'
import { describeError, listThreads } from '../shared/thread-index'

/** GET /api/threads: the thread list, newest first, and where checkpoints are kept. */
export default async (req: Request): Promise<Response> => {
  try {
    const refused = checkRequest(req, 'GET')
    if (refused) return refused
    const { store, kind } = activeStore()
    // Reads of many summaries get a shorter limit each, so one slow read cannot hold the whole list.
    const threads = await listThreads(guardStore(store, undefined, 4_000))
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
