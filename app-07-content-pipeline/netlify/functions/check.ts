import { clientKey, corsHeaders, originAllowed, rateLimited } from '../shared/access'
import { CHECK_REQUEST_LIMIT_MS } from '../shared/citecheck'
import { runCheck } from '../shared/citerun'
import { MAX_STAGE_TEXT_CHARS } from '../shared/stages'
import { withDeadline } from '../shared/deadline'
import { citableSources, parseSourcePack } from '../shared/sourcepack'

// The citation check is its own request, after the piece is written, so no stage request grows past its
// budget. The body is the polished text (without its Sources list) and the Sources stage output the writer saw.
const MAX_BODY_BYTES = 64 * 1024
const MAX_SOURCES_CHARS = 24_000

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

// `unreported` is how many model calls may have been billed without a usage report coming back.
const failed = (error: string, status: number, origin: string | null, unreported = 0) => json({ error, unreported }, status, origin)

async function handle(req: Request, origin: string | null): Promise<Response> {
  if (!originAllowed(origin, new URL(req.url).origin)) {
    return new Response('Origin not allowed', { status: 403, headers: corsHeaders(null) })
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) })
  if (rateLimited(`check:${clientKey(req)}`)) return failed('Too many checks from this connection. Wait a minute and try again.', 429, origin)
  if (!process.env.OPENROUTER_API_KEY) return failed('The AI provider is not set up for this site.', 500, origin)

  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return failed('The request is too large.', 413, origin)
  const raw = await req.text()
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return failed('The request is too large.', 413, origin)
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return failed('The request is not valid JSON.', 400, origin)
  }
  const input = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  const sources = typeof input.sources === 'string' ? input.sources : ''
  if (!text) return failed('There is no text to check.', 400, origin)
  if (text.length > MAX_STAGE_TEXT_CHARS || sources.length > MAX_SOURCES_CHARS) return failed('The request is too large.', 413, origin)

  // Only sources with an extract can be cited, so only those can back a sentence. The check reads that extract.
  const held = citableSources(parseSourcePack(sources)).sources.map(source => ({ n: source.n, title: source.title, summary: source.summary }))
  const result = await runCheck(text, held, req.signal)
  return json(result, 200, origin)
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  try {
    // The whole request stops here, body read included, so the browser's wait of this limit plus 3 s is never past 30 s.
    return await withDeadline(CHECK_REQUEST_LIMIT_MS, req.signal, () => handle(req, origin))
  } catch (err) {
    if (req.signal.aborted) return failed('The check was stopped.', 499, origin)
    if (err instanceof DOMException && err.name === 'TimeoutError') return failed('The citation check took too long.', 504, origin, 1)
    console.error(`check function failed: ${err instanceof Error ? err.name : 'unknown error'}`)
    return failed('Something went wrong on the server. Try again.', 500, origin, 1)
  }
}

export const config = { path: '/api/check' }
