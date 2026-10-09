import { arxivPdfUrl } from './arxivId'

/** Largest PDF read. A longer body stops being read at this size. */
export const MAX_PDF_BYTES = 5 * 1024 * 1024

/** The download is abandoned when nothing arrives for this long, before the reply or between chunks. */
export const STALL_MS = 15_000

/** A paper that could not be fetched, with a sentence safe to show. */
export class ArxivError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArxivError'
  }
}

export const TOO_LARGE_MESSAGE = `That paper is larger than ${MAX_PDF_BYTES / (1024 * 1024)} MB. Try a shorter one, or download it and use Upload.`
const UNREACHABLE_MESSAGE =
  'Could not load that paper from arXiv. Check the ID and your connection, then try again. A paper that does not exist fails the same way.'

/** A failed attempt that is worth one more try: the request itself did not complete. */
class NetworkFailure extends Error {}

/**
 * One attempt. The browser asks arxiv.org directly, which allows cross-origin reads of its PDFs.
 * The watchdog restarts at the reply and after every chunk, so only a stalled download is cut off.
 * A slow download that keeps receiving bytes is left to finish. The 5 MB cap bounds its size.
 */
async function download(id: string, signal: AbortSignal | undefined): Promise<Blob> {
  const watchdog = new AbortController()
  const stalled = () => watchdog.abort(new DOMException('The download stalled.', 'TimeoutError'))
  let timer = setTimeout(stalled, STALL_MS)
  const rearm = () => {
    clearTimeout(timer)
    timer = setTimeout(stalled, STALL_MS)
  }
  try {
    let response: Response
    try {
      response = await fetch(arxivPdfUrl(id), { signal: AbortSignal.any(signal ? [watchdog.signal, signal] : [watchdog.signal]) })
    } catch (err) {
      if (signal?.aborted) throw err
      if (watchdog.signal.aborted) throw new ArxivError('arXiv did not answer in time. Try again.')
      throw new NetworkFailure()
    }
    rearm()
    if (response.status === 404) throw new ArxivError('arXiv has no paper with that ID.')
    if (response.status === 429) throw new ArxivError('arXiv is rate limiting requests. Try again in a minute.')
    if (!response.ok || !response.body) throw new ArxivError('arXiv could not provide that paper right now. Try again shortly.')
    if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/pdf')) {
      await response.body.cancel().catch(() => undefined)
      throw new ArxivError('arXiv did not return a PDF for that ID.')
    }
    if (Number(response.headers.get('content-length') ?? 0) > MAX_PDF_BYTES) {
      await response.body.cancel().catch(() => undefined)
      throw new ArxivError(TOO_LARGE_MESSAGE)
    }

    const reader = response.body.getReader()
    const parts: Uint8Array<ArrayBuffer>[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_PDF_BYTES) {
          await reader.cancel().catch(() => undefined)
          throw new ArxivError(TOO_LARGE_MESSAGE)
        }
        parts.push(value as Uint8Array<ArrayBuffer>)
        rearm()
      }
    } catch (err) {
      if (err instanceof ArxivError || signal?.aborted) throw err
      throw new ArxivError(
        watchdog.signal.aborted
          ? 'arXiv stopped sending the paper. Try again.'
          : 'The PDF download was cut short. Try again.',
      )
    }
    return new Blob(parts, { type: 'application/pdf' })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetches a paper's PDF straight from arxiv.org and returns it as a file for the PDF reader.
 * A request that fails outright is tried once more. An error reply from arXiv carries no CORS
 * header, so the browser reports a missing paper and a dropped connection the same way.
 */
export async function fetchArxivFile(id: string, signal?: AbortSignal): Promise<File> {
  let blob: Blob
  try {
    blob = await download(id, signal)
  } catch (err) {
    if (!(err instanceof NetworkFailure)) throw err
    try {
      blob = await download(id, signal)
    } catch (retryErr) {
      if (retryErr instanceof NetworkFailure) throw new ArxivError(UNREACHABLE_MESSAGE)
      throw retryErr
    }
  }
  return new File([blob], `${id.replace('/', '_')}.pdf`, { type: 'application/pdf' })
}
