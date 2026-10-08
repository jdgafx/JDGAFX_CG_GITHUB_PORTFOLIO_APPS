import { chat } from '../shared/openrouter'
import { checkRequest, fail, json, SERVER_ERROR, threadIdFrom } from '../shared/guard'
import { readThread } from '../shared/run'
import { activeStore, storeTimeoutOf } from '../shared/store'

/** GET /api/thread?id=: one thread's status, its pending proposal while waiting, and its result when done. */
export default async (req: Request): Promise<Response> => {
  try {
    const refused = checkRequest(req, 'GET')
    if (refused) return refused
    const threadId = threadIdFrom(new URL(req.url).searchParams.get('id'))
    if (!threadId) return fail('Pass a valid thread id.', 400)

    const { store, kind } = activeStore()
    const view = await readThread({ store, storage: kind, chat, now: () => new Date() }, threadId)
    if (!view) return fail('Thread not found.', 404)
    return json({ success: true, ...view }, 200)
  } catch (err) {
    const timeout = storeTimeoutOf(err)
    if (timeout) return fail(timeout.message, 503)
    console.error('GraphGate: unexpected thread error', err)
    return fail(SERVER_ERROR, 500)
  }
}

export const config = {
  path: '/api/thread',
}
