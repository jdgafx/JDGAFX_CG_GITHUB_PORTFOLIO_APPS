import type { LeaderboardRow, RatingChange } from '../../netlify/shared/contract'

// How far each model moved in the ranking because of the vote just cast: positive is up. A model with no
// earlier rating (its first vote) has no shift. The earlier order uses the earlier ratings and vote counts,
// with the board's own tie-break (more votes, then id).
export function rankShifts(rows: LeaderboardRow[], changes: RatingChange[]): Map<string, number> {
  const before = new Map(changes.map(c => [c.model, c.before]))
  const fresh = new Set(rows.filter(r => before.has(r.model) && r.votes <= 1).map(r => r.model))
  const earlier = rows
    .filter(r => !fresh.has(r.model))
    .map(r => ({ model: r.model, rating: before.get(r.model) ?? r.rating, votes: before.has(r.model) ? r.votes - 1 : r.votes }))
    .sort((a, b) => b.rating - a.rating || b.votes - a.votes || a.model.localeCompare(b.model))
  const shifts = new Map<string, number>()
  const now = rows.filter(r => !fresh.has(r.model))
  for (const [i, row] of now.entries()) {
    const was = earlier.findIndex(e => e.model === row.model)
    if (before.has(row.model) && was >= 0) shifts.set(row.model, was - i)
  }
  return shifts
}

// One caption for the board when every row says the same thing, so the pill is not repeated down the table.
export function sharedConfidence(rows: LeaderboardRow[]): LeaderboardRow['confidence'] | null {
  if (rows.length < 2) return null
  return rows.every(r => r.confidence === rows[0].confidence) ? rows[0].confidence : null
}
