export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

// Catalogue prices are USD per token, sent as strings. A missing, negative or
// non-numeric price counts as unknown (OpenRouter sends -1 for dynamic pricing).
export function perToken(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function errorName(err: unknown): string {
  return isRecord(err) && typeof err.name === 'string' ? err.name : 'UnknownError'
}
