import { fetchArxivPdf } from '../shared/arxiv'
import { clientKey, originAllowed, RATE_LIMIT_MESSAGE, rateLimited, RATE_LIMIT_WINDOW_MS } from '../shared/http'

export const config = { path: '/api/arxiv' }

const FAILED_MESSAGE = 'The arXiv fetch failed. Please try again.'

const json = (status: number, payload: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), { status, headers: { ...extra, 'Content-Type': 'application/json' } })

/**
 * GET /api/arxiv?id=<arXiv ID>. Streams that paper's PDF from arxiv.org to the browser,
 * which reads it with the same in-browser PDF reader as an upload. The host is fixed in
 * netlify/shared/arxiv.ts, so the only input is a validated ID.
 */
async function respond(req: Request): Promise<Response> {
  if (!originAllowed(req.headers.get('origin'))) return json(403, { error: 'Origin not allowed.' })
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' }, { Allow: 'GET' })
  if (rateLimited(`arxiv:${clientKey(req)}`)) {
    return json(429, { error: RATE_LIMIT_MESSAGE }, { 'Retry-After': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) })
  }

  const id = new URL(req.url).searchParams.get('id') ?? ''
  const result = await fetchArxivPdf(id, req.signal)
  if (!result.ok) return json(result.status, { error: result.message })

  return new Response(result.bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(result.bytes.byteLength),
      // A paper's PDF changes only when a new version is posted.
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

export default async (req: Request): Promise<Response> => {
  try {
    return await respond(req)
  } catch (err) {
    console.error('DocMind arXiv request failed:', err)
    return json(500, { error: FAILED_MESSAGE })
  }
}
