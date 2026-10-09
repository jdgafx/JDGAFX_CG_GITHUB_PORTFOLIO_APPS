import { arxivProxyPath } from './arxivId'

/** Longest wait for the function, which itself gives arXiv 20 seconds. */
const REQUEST_TIMEOUT_MS = 30_000

/** A paper that could not be fetched, with a sentence safe to show. */
export class ArxivError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArxivError'
  }
}

/** The error sentence a failed reply carries, or a generic one when it has none. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim() !== '') return body.error
  } catch {
    // The body was not JSON. The generic sentence below covers it.
  }
  return response.status === 429
    ? 'Rate limited, try again in a minute.'
    : 'The paper could not be fetched right now. Try again shortly.'
}

/** Fetches a paper's PDF through this app's function and returns it as a file for the PDF reader. */
export async function fetchArxivFile(id: string, signal?: AbortSignal): Promise<File> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(arxivProxyPath(id), { signal: signal ? AbortSignal.any([timeout, signal]) : timeout })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new ArxivError(
      timeout.aborted ? 'arXiv did not answer in time. Try again.' : 'Could not reach the server. Check your connection and try again.',
    )
  }
  if (!response.ok) throw new ArxivError(await errorMessage(response))
  if (!(response.headers.get('content-type') ?? '').startsWith('application/pdf')) {
    throw new ArxivError('The server did not return a PDF for that ID.')
  }
  try {
    return new File([await response.blob()], `${id.replace('/', '_')}.pdf`, { type: 'application/pdf' })
  } catch {
    throw new ArxivError('The PDF download was cut short. Try again.')
  }
}
