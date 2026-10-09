import { checkRequest, fail, json, SERVER_ERROR } from '../shared/guard'
import { activeStore, guardStore, MEMORY_NOTICE, storeTimeoutOf } from '../shared/store'
import { listThreads } from '../shared/thread-index'

/** GET /api/threads: the thread list, newest first, and where checkpoints are kept. */
export default async (req: Request): Promise<Response> => {
  try {
    const refused = checkRequest(req, 'GET')
    if (refused) return refused
    const { store, kind } = activeStore()
    const threads = await listThreads(guardStore(store))
    return json({ success: true, storage: kind, notice: kind === 'memory' ? MEMORY_NOTICE : null, threads }, 200)
  } catch (err) {
    const timeout = storeTimeoutOf(err)
    if (timeout) return fail(timeout.message, 503)
    console.error('GraphGate: unexpected threads error', err)
    return fail(SERVER_ERROR, 500)
  }
}

export const config = {
  path: '/api/threads',
}
