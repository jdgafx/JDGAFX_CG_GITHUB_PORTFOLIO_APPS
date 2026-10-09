import { describe, expect, it } from 'vitest'
import { applyBallot, confidenceOf, expectedScore, freshRating, rankRows, type Entry, type Ratings } from '../../netlify/shared/elo'

const entry = (model: string, served: string | null = null): Entry => ({ model, served })

describe('expected score', () => {
  it('is one half between equal ratings and 0.759747 for a 200 point favourite', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5)
    expect(expectedScore(1200, 1000)).toBeCloseTo(0.7597469, 6)
    expect(expectedScore(1000, 1200)).toBeCloseTo(0.2402531, 6)
  })
})

describe('applyBallot', () => {
  it('moves two equal models by exactly K/2 each (K = 24)', () => {
    const { ratings, changes } = applyBallot({}, [entry('a'), entry('b')], { winner: 0 })
    expect(ratings.a).toMatchObject({ rating: 1012, wins: 1, losses: 0, ties: 0, votes: 1 })
    expect(ratings.b).toMatchObject({ rating: 988, wins: 0, losses: 1, ties: 0, votes: 1 })
    expect(changes).toEqual([
      { model: 'a', before: 1000, after: 1012 },
      { model: 'b', before: 1000, after: 988 },
    ])
  })

  it('treats a winner among three as two matches: +24 for the winner, -12 for each loser', () => {
    const { ratings } = applyBallot({}, [entry('a'), entry('b'), entry('c')], { winner: 1 })
    expect(ratings.b).toMatchObject({ rating: 1024, wins: 2, losses: 0 })
    expect(ratings.a).toMatchObject({ rating: 988, wins: 0, losses: 1 })
    expect(ratings.c).toMatchObject({ rating: 988, wins: 0, losses: 1 })
  })

  it('scores a three-way tie as three draws between equal models: no movement, two ties each', () => {
    const { ratings } = applyBallot({}, [entry('a'), entry('b'), entry('c')], 'tie')
    for (const id of ['a', 'b', 'c']) expect(ratings[id]).toMatchObject({ rating: 1000, ties: 2, wins: 0, losses: 0, votes: 1 })
  })

  it('pays an upset more than an expected win, using the ratings from before the ballot', () => {
    const before: Ratings = {
      strong: { ...freshRating(), rating: 1200 },
      weak: { ...freshRating(), rating: 1000 },
    }
    const expected = applyBallot(before, [entry('strong'), entry('weak')], { winner: 0 }).ratings
    expect(expected.strong.rating).toBeCloseTo(1200 + 24 * (1 - 0.7597469), 4)
    expect(expected.weak.rating).toBeCloseTo(1000 - 24 * (1 - 0.7597469), 4)
    const upset = applyBallot(before, [entry('strong'), entry('weak')], { winner: 1 }).ratings
    expect(upset.weak.rating).toBeCloseTo(1000 + 24 * 0.7597469, 4)
    expect(upset.strong.rating).toBeCloseTo(1200 - 24 * 0.7597469, 4)
  })

  it('is zero-sum and does not change the ratings it was given', () => {
    const before: Ratings = { a: { ...freshRating(), rating: 1100 }, b: { ...freshRating(), rating: 900 } }
    const copy = structuredClone(before)
    const { ratings } = applyBallot(before, [entry('a'), entry('b'), entry('c')], { winner: 2 })
    expect(before).toEqual(copy)
    expect(ratings.a.rating + ratings.b.rating + ratings.c.rating).toBeCloseTo(3000, 9)
  })

  it('never lets a model play itself: a repeated model id is one player', () => {
    const { ratings } = applyBallot({}, [entry('h'), entry('h'), entry('x')], { winner: 0 })
    expect(ratings.h).toMatchObject({ rating: 1012, wins: 1, votes: 1 })
    expect(ratings.x).toMatchObject({ rating: 988, losses: 1, votes: 1 })
  })

  it('counts "all bad" as a ballot for every model and moves no rating', () => {
    const { ratings, changes } = applyBallot({}, [entry('a'), entry('b'), entry('c')], 'all-bad')
    for (const id of ['a', 'b', 'c']) expect(ratings[id]).toEqual({ ...freshRating(), votes: 1 })
    expect(changes.every(c => c.before === c.after)).toBe(true)
  })

  it('remembers the model id the provider served', () => {
    const { ratings } = applyBallot({}, [entry('google/g', 'google/g-001'), entry('b')], { winner: 0 })
    expect(ratings['google/g'].lastServed).toBe('google/g-001')
    expect(ratings.b.lastServed).toBeNull()
  })
})

describe('ranking and confidence', () => {
  it('orders by rating, then votes, then id, and numbers the ranks from 1', () => {
    const r = (rating: number, votes: number) => ({ ...freshRating(), rating, votes })
    const rows = rankRows({ z: r(1000, 4), a: r(1000, 4), m: r(1000, 9), top: r(1100, 1) })
    expect(rows.map(x => [x.rank, x.model])).toEqual([[1, 'top'], [2, 'm'], [3, 'a'], [4, 'z']])
  })

  it('calls under 5 votes few, under 20 provisional, and 20 or more steady', () => {
    expect([0, 4, 5, 19, 20].map(confidenceOf)).toEqual(['few', 'few', 'provisional', 'provisional', 'steady'])
  })
})
