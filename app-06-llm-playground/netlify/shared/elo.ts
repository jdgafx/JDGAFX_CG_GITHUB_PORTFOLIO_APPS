import { ELO_K, ELO_START, FEW_VOTES, STEADY_VOTES, type Confidence, type LeaderboardRow, type RatingChange } from './contract'

// Standard Elo, applied pairwise to one ballot. A visitor who picks the best of several answers
// has said the winner beat each other answer, so one ballot is several matches. Every expected
// score comes from the ratings before the ballot, so the result does not depend on match order.

export interface Rating {
  rating: number
  wins: number
  losses: number
  ties: number
  // Ballots this model appeared in, including "all bad" ballots.
  votes: number
  lastServed: string | null
}

export type Ratings = Record<string, Rating>

// One answered panel of a ballot. `model` is the requested model id (the leaderboard key).
export interface Entry {
  model: string
  served: string | null
}

export type Outcome = { winner: number } | 'tie' | 'all-bad'

export function freshRating(): Rating {
  return { rating: ELO_START, wins: 0, losses: 0, ties: 0, votes: 0, lastServed: null }
}

/** The chance that a player rated `ra` beats one rated `rb`. */
export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** ((rb - ra) / 400))
}

export interface Applied {
  ratings: Ratings
  changes: RatingChange[]
}

/**
 * Applies one ballot to the ratings and returns new ratings, leaving the input untouched.
 * A winner scores 1 against each other entry and the others score 0. A tie scores 0.5 between
 * every pair. "All bad" moves no rating but counts as a ballot for every model in it.
 * Two entries with the same model id never play each other: a model cannot beat itself.
 */
export function applyBallot(before: Ratings, entries: Entry[], outcome: Outcome): Applied {
  const ratings: Ratings = { ...before }
  const models = [...new Set(entries.map(e => e.model))]
  const start = (model: string): Rating => ({ ...(before[model] ?? freshRating()) })
  for (const model of models) ratings[model] = start(model)

  const delta = new Map<string, number>(models.map(m => [m, 0]))
  const tally = (model: string, field: 'wins' | 'losses' | 'ties') => {
    ratings[model][field] += 1
  }

  if (outcome !== 'all-bad') {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i].model
        const b = entries[j].model
        if (a === b) continue
        const scoreA = outcome === 'tie' ? 0.5 : outcome.winner === i ? 1 : outcome.winner === j ? 0 : null
        if (scoreA === null) continue
        const expectedA = expectedScore(before[a]?.rating ?? ELO_START, before[b]?.rating ?? ELO_START)
        delta.set(a, (delta.get(a) ?? 0) + ELO_K * (scoreA - expectedA))
        delta.set(b, (delta.get(b) ?? 0) + ELO_K * (1 - scoreA - (1 - expectedA)))
        if (scoreA === 0.5) {
          tally(a, 'ties')
          tally(b, 'ties')
        } else {
          tally(scoreA === 1 ? a : b, 'wins')
          tally(scoreA === 1 ? b : a, 'losses')
        }
      }
    }
  }

  const changes: RatingChange[] = []
  for (const model of models) {
    const prior = before[model]?.rating ?? ELO_START
    ratings[model].rating = prior + (delta.get(model) ?? 0)
    ratings[model].votes += 1
    const served = entries.find(e => e.model === model)?.served ?? null
    if (served) ratings[model].lastServed = served
    changes.push({ model, before: prior, after: ratings[model].rating })
  }
  return { ratings, changes }
}

export function confidenceOf(votes: number): Confidence {
  if (votes < FEW_VOTES) return 'few'
  return votes < STEADY_VOTES ? 'provisional' : 'steady'
}

/** The ranked table: highest rating first, then more votes, then model id so the order is stable. */
export function rankRows(ratings: Ratings): LeaderboardRow[] {
  return Object.entries(ratings)
    .sort(([ida, a], [idb, b]) => b.rating - a.rating || b.votes - a.votes || ida.localeCompare(idb))
    .map(([model, r], i) => ({
      rank: i + 1,
      model,
      rating: r.rating,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      votes: r.votes,
      lastServed: r.lastServed,
      confidence: confidenceOf(r.votes),
    }))
}
