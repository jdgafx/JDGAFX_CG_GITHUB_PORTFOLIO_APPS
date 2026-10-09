import { SERVER_ERROR } from '../shared/errors'
import { runResearch } from '../shared/graph/stream'
import { MAX_BODY_BYTES, validateQuestion } from '../shared/guard'
import { chat } from '../shared/openrouter'
import { fail, gate, HARD_STOP_GRACE_MS, HEARTBEAT_MS, RUN_BUDGET_MS, streamRun } from '../shared/serve'
import { liveWiki } from '../shared/wikipedia'

export { HARD_STOP_GRACE_MS, HEARTBEAT_MS, RUN_BUDGET_MS }

export default async (req: Request): Promise<Response> => {
  let headers: Record<string, string> = {}
  try {
    const gated = await gate(req, MAX_BODY_BYTES)
    if (!gated.ok) return gated.response
    headers = gated.headers
    const checked = validateQuestion(gated.body)
    if (!checked.ok) return fail(checked.message, 400, headers)

    const secret = process.env.OPENROUTER_API_KEY
    return streamRun(
      (signal, deadline, emit) => runResearch(checked.question, { chat, wiki: liveWiki, signal, deadline, secret }, emit),
      headers,
    )
  } catch (err) {
    console.error('GraphScout: unexpected server error', err instanceof Error ? err.name : 'unknown')
    return fail(SERVER_ERROR, 500, headers)
  }
}

export const config = {
  path: '/api/run',
}
