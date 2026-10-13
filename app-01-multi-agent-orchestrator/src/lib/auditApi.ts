import type { AuditResult, Source, StageUsage } from '../types'
import { isAbortError, serverMessage } from './api'

const AUDIT_URL = '/api/audit'
/** The server's audit budget is 26 s; the browser waits a wide margin past it, body read included. */
export const AUDIT_TIMEOUT_MS = 45_000

/**
 * A failure whose message was written for the visitor. `usage` is what the provider billed for the failed audit:
 * absent when the server made no model call, empty when it made one and the provider named no figures.
 */
export class AuditError extends Error {
  constructor(
    message: string,
    options?: ErrorOptions & { usage?: StageUsage; usageGaps?: number },
  ) {
    super(message, options)
    this.name = 'AuditError'
    if (options?.usage) this.usage = options.usage
    if (options?.usageGaps) this.usageGaps = options.usageGaps
  }

  usage?: StageUsage
  /** How many of the failed audit's calls reported no usage, so `usage` is a floor. */
  usageGaps?: number
}

/** The usage a failure body carries, or undefined when it carries none. */
function usageOf(body: string): { usage: StageUsage; usageGaps: number } | undefined {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && 'usage' in parsed && parsed.usage && typeof parsed.usage === 'object') {
      const usage: StageUsage = {}
      for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const) {
        const value = (parsed.usage as Record<string, unknown>)[field]
        if (typeof value === 'number' && Number.isFinite(value)) usage[field] = value
      }
      const gaps = (parsed as { usageGaps?: unknown }).usageGaps
      return { usage, usageGaps: typeof gaps === 'number' && gaps > 0 ? gaps : 0 }
    }
  } catch {
    /* not JSON: no usage */
  }
  return undefined
}

const UNREACHABLE = 'Could not reach the server for the audit. Check your connection and try again.'
const TOO_LONG = 'The audit took too long and was ended. Try again.'
const BAD_REPLY = 'The audit returned something unexpected. Try again.'

function isAuditResult(value: unknown): value is AuditResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'claims' in value &&
    Array.isArray(value.claims) &&
    'summary' in value &&
    typeof value.summary === 'object'
  )
}

/** The text to show for a failed audit. Anything that is not an AuditError stays off the screen. */
export function auditErrorMessage(err: unknown): string {
  return err instanceof AuditError ? err.message : BAD_REPLY
}

/**
 * Asks the server to audit a finished report against the sources it cites. One request, one timer that covers
 * the connection and the body read; the visitor's stop signal ends it too (an AbortError).
 */
export async function requestAudit(
  report: string,
  sources: Source[],
  signal?: AbortSignal,
  timeoutMs: number = AUDIT_TIMEOUT_MS,
): Promise<AuditResult> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onStop = () => controller.abort()
  signal?.addEventListener('abort', onStop, { once: true })
  if (signal?.aborted) controller.abort()

  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new DOMException('The audit was aborted.', 'AbortError')), { once: true })
  })

  const work = (async (): Promise<AuditResult> => {
    const response = await fetch(AUDIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report,
        sources: sources.map(({ n, title, site, snippet, note }) => ({ n, title, site, snippet, ...(note ? { note } : {}) })),
      }),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      const billed = usageOf(text)
      throw new AuditError(serverMessage(text) ?? (response.status === 429 ? 'Rate limited, try again in a minute.' : 'The audit could not run. Try again.'), billed ?? undefined)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new AuditError(BAD_REPLY)
    }
    if (!isAuditResult(parsed)) throw new AuditError(BAD_REPLY)
    return parsed
  })()
  void work.catch(() => undefined)

  try {
    return await Promise.race([work, aborted])
  } catch (err) {
    if (signal?.aborted) throw err
    if (timedOut) throw new AuditError(TOO_LONG, { cause: err })
    if (err instanceof AuditError || isAbortError(err)) throw err
    throw new AuditError(UNREACHABLE, { cause: err })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onStop)
  }
}
