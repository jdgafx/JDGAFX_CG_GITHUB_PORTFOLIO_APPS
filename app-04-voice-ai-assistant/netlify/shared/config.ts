// Reads a whole-number setting from the environment. A missing, blank or
// non-numeric value gives the fallback. Any number is clamped into [min, max],
// so one bad variable cannot switch a limit off (NaN compares false against
// everything) or send an invalid value upstream.
export function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}
