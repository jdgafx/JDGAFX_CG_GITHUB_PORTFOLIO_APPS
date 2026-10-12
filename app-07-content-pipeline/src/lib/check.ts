import { BATCH_CLAIMS, CHECK_WATCHDOG_MS, MAX_CLAIMS, extractClaims, viewOf, type CheckedClaim, type CiteView, type Verdict } from '../../netlify/shared/citecheck'
import type { TraceRow } from '../../netlify/shared/contract'
import { readCheck, readUsage, type CallRecord } from './api'

// The citation check of the finished piece: one request after the last stage. It never changes the run's
// outcome. When it cannot run, the piece stays and every cited sentence says it was not checked.

const CHECK_PATH = '/api/check'
const VERDICTS: readonly Verdict[] = ['supported', 'partly', 'unsupported', 'unverified', 'unchecked']

export interface PieceCheck {
  /** The piece body this check belongs to, so a result is never shown against other text. */
  key: string
  status: 'checking' | 'done' | 'failed'
  claims: CheckedClaim[]
  /** Why the check could not run, when it failed. */
  message?: string
}

export interface CiteMark {
  view: CiteView
  /** Short words on why, shown beside a sentence that is not confirmed or not checked. */
  note?: string
}

/**
 * The mark of one cited sentence. A verdict applies only to the sentence the server read with the same number
 * and the same words; any other case is not checked, never confirmed.
 */
export function markFor(check: PieceCheck | null, id: number, text: string): CiteMark {
  if (!check) return { view: 'not_checked' }
  if (check.status === 'checking') return { view: 'checking' }
  if (check.status === 'failed') return { view: 'not_checked', ...(check.message ? { note: check.message } : {}) }
  const claim = check.claims.find(candidate => candidate.id === id)
  if (!claim || claim.text !== text) return { view: 'not_checked', note: 'The check did not report this sentence.' }
  const view = viewOf(claim.verdict)
  const note = view === 'confirmed' ? undefined : [claim.reason, claim.uncovered ? `Not in the source: ${claim.uncovered}` : ''].filter(Boolean).join(' ')
  return { view, ...(note ? { note } : {}) }
}

/** How many cited sentences the piece body has, which is how many the check can mark. */
export function citedCount(body: string): number {
  return extractClaims(body).length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readClaims(value: unknown): CheckedClaim[] | null {
  if (!Array.isArray(value)) return null
  const claims: CheckedClaim[] = []
  for (const item of value) {
    const verdict = isRecord(item) ? VERDICTS.find(candidate => candidate === item.verdict) : undefined
    if (!isRecord(item) || typeof item.id !== 'number' || typeof item.text !== 'string' || !verdict) return null
    claims.push({
      id: item.id,
      text: item.text,
      verdict,
      reason: typeof item.reason === 'string' ? item.reason.slice(0, 300) : '',
      ...(typeof item.uncovered === 'string' && item.uncovered ? { uncovered: item.uncovered.slice(0, 300) } : {}),
    })
  }
  return claims
}

/**
 * When the whole request fails after it may have reached the model, every batch it could have made may have been billed
 * with no usage reported back. One record per possible batch keeps the run's total a floor, never a silent undercount.
 */
function mayBeBilled(body: string, ms: number, detail: string): CallRecord[] {
  const batches = Math.max(1, Math.ceil(Math.min(citedCount(body), MAX_CLAIMS) / BATCH_CLAIMS))
  return Array.from({ length: batches }, (_, i): CallRecord => ({
    stage: 'check', usage: null, model: null, newestModel: null, modelCheck: null,
    row: { name: batches > 1 ? `Citation check ${i + 1} of ${batches}` : 'Citation check', status: 'failed', ms, detail },
  }))
}

function readCalls(value: unknown): CallRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, i): CallRecord[] => {
    if (!isRecord(item) || typeof item.ms !== 'number' || typeof item.detail !== 'string') return []
    const usage = readUsage(item.usage)
    const row: TraceRow = {
      name: value.length > 1 ? `Citation check ${i + 1} of ${value.length}` : 'Citation check',
      status: item.status === 'ok' ? 'ok' : 'failed',
      ms: item.ms,
      detail: item.detail,
      tokens: usage?.total_tokens,
      cost: usage?.cost,
    }
    return [{
      stage: 'check',
      row,
      usage,
      model: typeof item.model === 'string' ? item.model : null,
      newestModel: typeof item.newestModel === 'string' ? item.newestModel : null,
      modelCheck: readCheck(item.modelCheck),
    }]
  })
}

export interface CheckOutcome {
  check: Omit<PieceCheck, 'key'>
  /** Every model call the check made or may have made, for the run's totals. */
  records: CallRecord[]
}

function failed(message: string, records: CallRecord[] = []): CheckOutcome {
  return { check: { status: 'failed', claims: [], message }, records }
}

/**
 * Sends the piece body and the Sources stage output to the server and reads the verdicts. Returns null when `signal`
 * aborted it (a new run or the page closing), which leaves nothing to show or count. `watchdogMs` is for tests.
 */
export async function checkPiece(body: string, sources: string, signal: AbortSignal, watchdogMs = CHECK_WATCHDOG_MS): Promise<CheckOutcome | null> {
  const sentAt = Date.now()
  const elapsed = () => Date.now() - sentAt
  const watchdog = AbortSignal.timeout(watchdogMs)
  let response: Response
  try {
    response = await fetch(CHECK_PATH, {
      method: 'POST',
      signal: AbortSignal.any([signal, watchdog]),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: body, sources }),
    })
  } catch {
    if (signal.aborted) return null
    return watchdog.aborted
      ? failed('The citation check did not answer in time.', mayBeBilled(body, elapsed(), `No answer after ${watchdogMs / 1000} s. The call may still be billed.`))
      : failed('The citation check could not be reached.', mayBeBilled(body, elapsed(), 'Connection lost before the check finished. The call may still be billed.'))
  }

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    if (signal.aborted) return null
    const timedOut = watchdog.aborted
    return failed(
      timedOut ? 'The citation check did not answer in time.' : 'The citation check returned an unreadable answer.',
      mayBeBilled(body, elapsed(), timedOut ? `No answer after ${watchdogMs / 1000} s. The call may still be billed.` : 'The response could not be read. The call may still be billed.'),
    )
  }
  const reply = isRecord(parsed) ? parsed : {}
  if (!response.ok) {
    // Only an explicit zero says no call was made; an answer from the platform in front of the function says nothing.
    const none = reply.unreported === 0
    return failed(typeof reply.error === 'string' ? reply.error.slice(0, 200) : 'The citation check could not run.', none ? [] : mayBeBilled(body, elapsed(), 'The check stopped. A call may still be billed.'))
  }
  const claims = readClaims(reply.claims)
  const records = readCalls(reply.calls)
  if (!claims) return failed('The citation check returned an unexpected answer.', records)
  return { check: { status: 'done', claims }, records }
}
