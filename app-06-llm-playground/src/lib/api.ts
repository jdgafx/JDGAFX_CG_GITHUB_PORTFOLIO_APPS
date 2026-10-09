import type {
  CatalogueResponse,
  CompareRequest,
  CompareResult,
  JudgeRequest,
  JudgeResponse,
  LeaderboardResponse,
  VoteRequest,
  VoteResponse,
} from '../../netlify/shared/contract'

// A message that is safe to show: the server writes these in plain language. `status` is the HTTP
// status when the server answered, so a caller can tell an expired run (410) from a busy board (503).
export class ApiError extends Error {
  readonly status: number | null
  constructor(message: string, status: number | null = null) {
    super(message)
    this.status = status
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

// Each call may take its server budget (24 s) plus a generous margin before the page gives up and says so.
// Nothing streams here, so there is no per-byte watchdog: the cap covers the reply and its body.
const COMPARE_CAP_MS = 60_000
const JUDGE_CAP_MS = 45_000
const QUICK_CAP_MS = 20_000

function postJson(body: unknown, signal?: AbortSignal): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }
}

async function request<T>(path: string, init: RequestInit, capMs: number): Promise<T> {
  // A referenced timer, so the cap holds whatever the connection does. It is cleared in `finally`.
  const cap = new AbortController()
  let capped = false
  const timer = setTimeout(() => {
    capped = true
    cap.abort()
  }, capMs)
  const signal = init.signal ? AbortSignal.any([init.signal, cap.signal]) : cap.signal
  try {
    let res: Response
    try {
      res = await fetch(path, { ...init, signal })
    } catch (err) {
      if (capped) throw slow(capMs)
      if (isAbortError(err)) throw err
      throw new ApiError('Could not reach the server. Check your connection and try again.')
    }
    // The body read is inside the cap too, so a reply that stalls midway still ends at the limit.
    let body: unknown
    try {
      body = await res.json()
    } catch (err) {
      if (capped) throw slow(capMs)
      if (isAbortError(err)) throw err
      body = null
    }
    if (!res.ok) {
      const message = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined
      if (typeof message === 'string') throw new ApiError(message, res.status)
      // A gateway timeout answers with an HTML page, not the JSON the functions send.
      if (res.status === 502 || res.status === 504) {
        throw new ApiError('The server did not answer in time. Try again, or use a shorter prompt.', res.status)
      }
      throw new ApiError(`Request failed with status ${res.status}`, res.status)
    }
    if (body === null) throw new ApiError('The server sent a reply that could not be read. Try again.')
    return body as T
  } finally {
    clearTimeout(timer)
  }
}

function slow(capMs: number): ApiError {
  return new ApiError(`The server did not answer within ${Math.round(capMs / 1000)} seconds. Try again, or use a shorter prompt.`)
}

export function fetchCatalogue(signal?: AbortSignal): Promise<CatalogueResponse> {
  return request<CatalogueResponse>('/api/models', { signal }, QUICK_CAP_MS)
}

export function fetchLeaderboard(signal?: AbortSignal): Promise<LeaderboardResponse> {
  return request<LeaderboardResponse>('/api/leaderboard', { signal }, QUICK_CAP_MS)
}

export function runCompare(body: CompareRequest, signal?: AbortSignal): Promise<CompareResult> {
  return request<CompareResult>('/api/compare', postJson(body, signal), COMPARE_CAP_MS)
}

export function runJudge(body: JudgeRequest, signal?: AbortSignal): Promise<JudgeResponse> {
  return request<JudgeResponse>('/api/judge', postJson(body, signal), JUDGE_CAP_MS)
}

export function runVote(body: VoteRequest, signal?: AbortSignal): Promise<VoteResponse> {
  return request<VoteResponse>('/api/vote', postJson(body, signal), QUICK_CAP_MS)
}
