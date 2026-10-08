import type {
  CatalogueResponse,
  CompareRequest,
  CompareResponse,
  JudgeRequest,
  JudgeResponse,
} from '../../netlify/shared/contract'

// A message that is safe to show: the server writes these in plain language.
export class ApiError extends Error {}

export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

function postJson(body: unknown, signal?: AbortSignal): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new ApiError('Could not reach the server. Check your connection and try again.')
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined
    if (typeof message === 'string') throw new ApiError(message)
    // A gateway timeout answers with an HTML page, not the JSON the functions send.
    if (res.status === 502 || res.status === 504) {
      throw new ApiError('The server did not answer in time. Try again, or use a shorter prompt.')
    }
    throw new ApiError(`Request failed with status ${res.status}`)
  }
  return body as T
}

export function fetchCatalogue(signal?: AbortSignal): Promise<CatalogueResponse> {
  return request<CatalogueResponse>('/api/models', { signal })
}

export function runCompare(body: CompareRequest, signal?: AbortSignal): Promise<CompareResponse> {
  return request<CompareResponse>('/api/compare', postJson(body, signal))
}

export function runJudge(body: JudgeRequest, signal?: AbortSignal): Promise<JudgeResponse> {
  return request<JudgeResponse>('/api/judge', postJson(body, signal))
}
