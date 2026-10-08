// Netlify's synchronous function limit is 60 seconds and cannot be configured. Each request gets
// one budget, and that budget is the real bound: every provider call takes at most what is left of it.
export const REQUEST_BUDGET_MS = 24_000

export function remainingMs(startedAt: number): number {
  return Math.max(0, startedAt + REQUEST_BUDGET_MS - Date.now())
}
