import { ARXIV_ID } from '../../src/lib/arxivId'
import { withDeadline } from './deadline'

/** The only host this function ever contacts. It is a literal, never taken from a request. */
const ARXIV_HOST = 'arxiv.org'

/** Largest PDF passed on. Netlify limits a synchronous response to about 6 MB. */
export const MAX_PDF_BYTES = 5 * 1024 * 1024

/** One budget for the whole fetch, inside the platform's ~30 s limit. */
export const FETCH_TIMEOUT_MS = 20_000

const MAX_REDIRECTS = 3

export const NOT_FOUND_MESSAGE = 'arXiv has no paper with that ID.'
export const NOT_A_PDF_MESSAGE = 'arXiv did not return a PDF for that ID.'
export const TOO_LARGE_MESSAGE = `That paper is larger than ${MAX_PDF_BYTES / (1024 * 1024)} MB. Try a shorter one, or download it and upload the file.`
export const ARXIV_TIMEOUT_MESSAGE = 'arXiv did not answer in time. Try again shortly.'

export type PdfResult = { ok: true; bytes: Uint8Array } | { ok: false; status: number; message: string }

/** The PDF URL for a validated ID. Throws on anything that is not an arXiv ID. */
export function arxivPdfUrl(id: string): string {
  if (!ARXIV_ID.test(id)) throw new Error('Not an arXiv ID.')
  return `https://${ARXIV_HOST}/pdf/${id}`
}

/** Reads a body up to `max` bytes, then stops reading. Null means the body was larger. */
async function readCapped(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
  const reader = body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    parts.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    bytes.set(part, at)
    at += part.byteLength
  }
  return bytes
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

/**
 * Fetches a paper's PDF from arxiv.org. A redirect is followed only when it stays on
 * arxiv.org over https, so a crafted ID cannot steer the request to another host.
 * The type, the declared size and the bytes actually received are all checked.
 */
export async function fetchArxivPdf(id: string, signal?: AbortSignal): Promise<PdfResult> {
  if (!ARXIV_ID.test(id)) return { ok: false, status: 400, message: 'That is not a valid arXiv ID.' }
  try {
    // One deadline covers every hop and the whole body read, so a stalled download ends at the limit.
    return await withDeadline(FETCH_TIMEOUT_MS, signal, async limit => {
      let url = arxivPdfUrl(id)
      for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
        const response = await fetch(url, { redirect: 'manual', headers: { Accept: 'application/pdf' }, signal: limit })

        if (response.status >= 300 && response.status < 400) {
          const next = new URL(response.headers.get('location') ?? '', url)
          if (next.protocol !== 'https:' || next.hostname !== ARXIV_HOST) {
            console.error('arXiv redirected off arxiv.org:', next.hostname)
            return { ok: false, status: 502, message: NOT_A_PDF_MESSAGE }
          }
          await response.body?.cancel().catch(() => undefined)
          url = next.toString()
          continue
        }

        if (response.status === 404) return { ok: false, status: 404, message: NOT_FOUND_MESSAGE }
        if (response.status === 429) return { ok: false, status: 429, message: 'arXiv is rate limiting requests. Try again in a minute.' }
        if (!response.ok || !response.body) return { ok: false, status: 502, message: 'arXiv could not provide that paper right now.' }
        if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/pdf')) {
          await response.body.cancel().catch(() => undefined)
          return { ok: false, status: 502, message: NOT_A_PDF_MESSAGE }
        }
        if (Number(response.headers.get('content-length') ?? 0) > MAX_PDF_BYTES) {
          await response.body.cancel().catch(() => undefined)
          return { ok: false, status: 413, message: TOO_LARGE_MESSAGE }
        }

        const bytes = await readCapped(response.body, MAX_PDF_BYTES)
        return bytes ? { ok: true, bytes } : { ok: false, status: 413, message: TOO_LARGE_MESSAGE }
      }
      return { ok: false, status: 502, message: NOT_A_PDF_MESSAGE }
    })
  } catch (err) {
    console.error('arXiv fetch failed:', err instanceof Error ? err.name : 'non-error')
    return isTimeout(err)
      ? { ok: false, status: 504, message: ARXIV_TIMEOUT_MESSAGE }
      : { ok: false, status: 502, message: 'Could not reach arXiv. Try again shortly.' }
  }
}
