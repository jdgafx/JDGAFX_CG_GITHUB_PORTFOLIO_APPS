import { RequestError, clientKey, corsHeaders, fail, isOriginAllowed, rateLimit } from '../shared/gate'
import { AUDIT_BUDGET_MS, AuditUnavailableError, readAuditRequest, runAudit } from '../shared/audit'
import { getProvider } from '../shared/provider'
import { RunCancelledError, friendlyUpstreamMessage, UpstreamError } from '../shared/stream'
import { withDeadline } from '../shared/deadline'

/** Hard stop for the whole request, body read included, a little past the audit's own budget. */
const REQUEST_LIMIT_MS = AUDIT_BUDGET_MS + 3_000

async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get('origin')
  const allowed = isOriginAllowed(req, origin)
  const headersOut = corsHeaders(req, origin)

  if (req.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: headersOut })
  if (!allowed) return fail('Origin not allowed.', 403, headersOut)
  if (req.method !== 'POST') return fail('Method not allowed.', 405, headersOut)

  const limit = rateLimit(`audit:${clientKey(req)}`)
  if (!limit.allowed) {
    return fail('Rate limited, try again in a minute.', 429, { ...headersOut, 'Retry-After': String(limit.retryAfter) })
  }

  let input
  try {
    input = await readAuditRequest(req)
  } catch (err) {
    if (err instanceof RequestError) return fail(err.message, err.status, headersOut)
    throw err
  }

  const provider = getProvider()
  if (!provider) return fail('The AI service is not configured on the server.', 500, headersOut)

  try {
    const result = await withDeadline(REQUEST_LIMIT_MS, req.signal, signal => runAudit(input, provider, signal))
    return new Response(JSON.stringify(result), {
      headers: { ...headersOut, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    if (err instanceof AuditUnavailableError) return fail(err.message, 502, headersOut)
    if (err instanceof UpstreamError) return fail(friendlyUpstreamMessage(err.status), 502, headersOut)
    if (err instanceof RunCancelledError || req.signal.aborted) return fail('The audit was cancelled.', 499, headersOut)
    if (err instanceof DOMException && err.name === 'TimeoutError') return fail('The audit took too long. Try again.', 504, headersOut)
    throw err
  }
}

/** Every request gets a response. Unexpected failures become a generic 500 JSON body. */
export default async (req: Request): Promise<Response> => {
  try {
    return await handle(req)
  } catch {
    return fail('Something went wrong on the server. Try again.', 500, corsHeaders(req, req.headers.get('origin')))
  }
}
