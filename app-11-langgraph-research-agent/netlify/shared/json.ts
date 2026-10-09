export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True for the error a fetch throws when its signal aborts: AbortError from a caller, TimeoutError from AbortSignal.timeout. */
export function isAbortError(err: unknown): boolean {
  return isRecord(err) && (err.name === 'AbortError' || err.name === 'TimeoutError')
}
