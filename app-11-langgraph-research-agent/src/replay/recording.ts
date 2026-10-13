// One recorded run of an app's built-in example, and the checks that decide whether it may be replayed.
// This file is shared byte for byte by every app that replays (scripts/replay/sync.sh); it imports nothing app-specific.

export const RECORDING_VERSION = 1
// A recording older than this is never replayed: the page shows today's empty state instead.
export const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
// A recording is a few hundred kB at most; anything bigger is not one of ours.
export const MAX_RECORDING_CHARS = 2_000_000
// A clock a little ahead of the recorder is fine; a recording dated further ahead is not trusted.
const CLOCK_SKEW_MS = 5 * 60 * 1000

export interface Chunk {
  /** ms after the click that started the run */
  t: number
  text: string
}

/** One same-origin /api/* request and its response, with times in ms after the click. */
export interface Exchange {
  method: string
  /** path and query, always starting with /api/ */
  path: string
  request_body: string | null
  status: number
  /** only the response headers the client needs (never cookies, length or encoding) */
  headers: Record<string, string>
  t_start: number
  t_headers: number
  t_end: number
  /** the response body in the order and at the times it arrived; one entry for a plain JSON reply */
  chunks: Chunk[]
}

/** What the app itself reported about the run, read from the recorded response bodies. */
export interface Reported {
  model: string
  /** which step the model belongs to, e.g. "judge" */
  model_role: string
  cost_usd: number
  /** what the cost covers, e.g. "judge call" */
  cost_scope: string
}

export interface Recording {
  version: typeof RECORDING_VERSION
  app: string
  url: string
  recorded_at: string
  reported: Reported
  exchanges: Exchange[]
}

export type LoadFailure = 'missing' | 'malformed' | 'stale'
export type LoadResult = { ok: true; recording: Recording } | { ok: false; reason: LoadFailure }

type Rec = Record<string, unknown>

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function time(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

function text(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function validChunks(v: unknown, from: number, to: number): v is Chunk[] {
  if (!Array.isArray(v)) return false
  let last = from
  for (const c of v) {
    if (!isRec(c) || !time(c.t) || typeof c.text !== 'string') return false
    if (c.t < last || c.t > to) return false
    last = c.t
  }
  return true
}

function validExchange(v: unknown): v is Exchange {
  if (!isRec(v)) return false
  if (!text(v.method) || !text(v.path) || !v.path.startsWith('/api/')) return false
  if (v.request_body !== null && typeof v.request_body !== 'string') return false
  // A recording of a run that errored is never replayed.
  if (typeof v.status !== 'number' || !Number.isInteger(v.status) || v.status < 200 || v.status > 299 || v.status === 204 || v.status === 205) return false
  if (!isRec(v.headers) || !Object.values(v.headers).every(h => typeof h === 'string')) return false
  if (!time(v.t_start) || !time(v.t_headers) || !time(v.t_end)) return false
  if (v.t_start > v.t_headers || v.t_headers > v.t_end) return false
  return validChunks(v.chunks, v.t_headers, v.t_end)
}

function validReported(v: unknown): v is Reported {
  return isRec(v) && text(v.model) && text(v.model_role) && text(v.cost_scope) && typeof v.cost_usd === 'number' && Number.isFinite(v.cost_usd) && v.cost_usd >= 0
}

/** The recording, or null when it is not a well-formed version-1 recording. Never throws. */
export function parseRecording(raw: unknown): Recording | null {
  if (!isRec(raw) || raw.version !== RECORDING_VERSION) return null
  if (!text(raw.app) || !text(raw.url) || !text(raw.recorded_at)) return null
  if (!Number.isFinite(Date.parse(raw.recorded_at))) return null
  if (!validReported(raw.reported)) return null
  if (!Array.isArray(raw.exchanges) || raw.exchanges.length === 0 || !raw.exchanges.every(validExchange)) return null
  return raw as unknown as Recording
}

/** True when the recording is older than maxAgeMs, or dated in the future beyond a small clock skew. */
export function isStale(recording: Recording, now: number, maxAgeMs: number = MAX_AGE_MS): boolean {
  const age = now - Date.parse(recording.recorded_at)
  return age > maxAgeMs || age < -CLOCK_SKEW_MS
}

/** How long the real run took, in ms: the end of its last response. */
export function spanMs(recording: Recording): number {
  return Math.max(...recording.exchanges.map(e => e.t_end))
}

/** Reads and checks the recording at url. Every failure is a reason, never an exception, so the page can fall back quietly. */
export async function loadRecording(url: string, now: number, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<LoadResult> {
  let res: Response
  try {
    res = await fetchImpl(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
  } catch {
    return { ok: false, reason: 'missing' }
  }
  if (!res.ok) return { ok: false, reason: 'missing' }
  let raw: unknown
  try {
    const body = await res.text()
    if (body.length > MAX_RECORDING_CHARS) return { ok: false, reason: 'malformed' }
    raw = JSON.parse(body)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const recording = parseRecording(raw)
  if (!recording) return { ok: false, reason: 'malformed' }
  if (isStale(recording, now)) return { ok: false, reason: 'stale' }
  return { ok: true, recording }
}
