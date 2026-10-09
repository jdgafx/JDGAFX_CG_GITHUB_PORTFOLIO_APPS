import { MAX_RESUME_BODY_BYTES, BAD_TOKEN_MESSAGE, rewindFor, verifyToken } from '../shared/checkpoint'
import { SERVER_ERROR } from '../shared/errors'
import { resumeResearch } from '../shared/graph/stream'
import { isRecord } from '../shared/json'
import { chat } from '../shared/openrouter'
import { fail, gate, streamRun } from '../shared/serve'
import { liveWiki } from '../shared/wikipedia'

/** Continues a finished run from a saved point with the visitor's edit. The token is the state, signed by this server. */
export default async (req: Request): Promise<Response> => {
  let headers: Record<string, string> = {}
  try {
    const gated = await gate(req, MAX_RESUME_BODY_BYTES)
    if (!gated.ok) return gated.response
    headers = gated.headers
    const secret = process.env.OPENROUTER_API_KEY ?? ''
    if (!isRecord(gated.body)) return fail('The request needs a token and an edit.', 400, headers)
    const snapshot = verifyToken(gated.body.token, secret, Date.now())
    if (!snapshot) return fail(BAD_TOKEN_MESSAGE, 400, headers)
    // The edit is checked before the stream opens, so a bad edit is a plain 400 and no model call is made.
    const rewind = rewindFor(snapshot, gated.body.edit)
    if (!rewind.ok) return fail(rewind.message, 400, headers)

    return streamRun(
      (signal, deadline, emit) => resumeResearch(snapshot, rewind.value, { chat, wiki: liveWiki, signal, deadline }, emit),
      headers,
    )
  } catch (err) {
    console.error('GraphScout: unexpected server error', err instanceof Error ? err.name : 'unknown')
    return fail(SERVER_ERROR, 500, headers)
  }
}

export const config = {
  path: '/api/resume',
}
