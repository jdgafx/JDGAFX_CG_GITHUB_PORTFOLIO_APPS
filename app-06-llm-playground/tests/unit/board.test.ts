import { describe, expect, it } from 'vitest'
import type { LeaderboardRow } from '../../netlify/shared/contract'
import { rankShifts, sharedConfidence } from '../../src/lib/board'
import { deltaParts } from '../../src/lib/format'

const row = (rank: number, model: string, rating: number, votes: number, confidence: LeaderboardRow['confidence'] = 'few'): LeaderboardRow => ({
  rank, model, rating, wins: 0, losses: 0, ties: 0, votes, lastServed: null, confidence,
})

describe('rankShifts', () => {
  it('reports a model that overtook another as up one and the overtaken as down one', () => {
    const rows = [row(1, 'b', 1010, 6), row(2, 'a', 1005, 6)]
    const shifts = rankShifts(rows, [{ model: 'b', before: 996, after: 1010 }, { model: 'a', before: 1005, after: 1005 }])
    expect(shifts.get('b')).toBe(1)
    expect(shifts.get('a')).toBe(-1)
  })

  it('reports no shift for a model that did not move, and none for a first vote', () => {
    const rows = [row(1, 'a', 1012, 1), row(2, 'b', 988, 1)]
    const shifts = rankShifts(rows, [{ model: 'a', before: 1000, after: 1012 }, { model: 'b', before: 1000, after: 988 }])
    expect(shifts.size).toBe(0)
    const same = rankShifts([row(1, 'a', 1020, 5), row(2, 'b', 1000, 5)], [{ model: 'a', before: 1010, after: 1020 }])
    expect(same.get('a')).toBe(0)
  })
})

describe('sharedConfidence', () => {
  it('names the level when all rows share it, and nothing when they differ or there is one row', () => {
    expect(sharedConfidence([row(1, 'a', 1, 6, 'provisional'), row(2, 'b', 1, 7, 'provisional')])).toBe('provisional')
    expect(sharedConfidence([row(1, 'a', 1, 6, 'provisional'), row(2, 'b', 1, 2, 'few')])).toBeNull()
    expect(sharedConfidence([row(1, 'a', 1, 6)])).toBeNull()
  })
})

describe('deltaParts', () => {
  it('splits a change into direction and one-decimal magnitude', () => {
    expect(deltaParts(32)).toEqual({ dir: 'up', value: '32.0' })
    expect(deltaParts(-16.64)).toEqual({ dir: 'down', value: '16.6' })
    expect(deltaParts(0.01)).toEqual({ dir: 'flat', value: '0.0' })
  })
})
