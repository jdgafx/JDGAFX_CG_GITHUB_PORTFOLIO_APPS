import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CatalogueResponse, LeaderboardResponse } from '../../netlify/shared/contract'
import { clock, liveIndicator } from '../../src/lib/liveData'
import type { BoardState } from '../../src/lib/useArena'

const FETCHED = new Date(2026, 9, 9, 14, 32).toISOString()
const catalogue = (source: CatalogueResponse['source']): CatalogueResponse => ({
  source,
  fetchedAt: source === 'fallback' ? null : FETCHED,
  defaultModel: '~anthropic/claude-haiku-latest',
  groups: [],
})
const ready: BoardState = { state: 'ready', board: { rows: [], ballots: 0 } as unknown as LeaderboardResponse }

describe('the live-data chip', () => {
  it('is idle while the model list or the board is loading', () => {
    expect(liveIndicator(null, false, { state: 'loading' }).state).toBe('idle')
    expect(liveIndicator(catalogue('live'), false, { state: 'loading' }).state).toBe('idle')
    expect(liveIndicator(null, false, { state: 'loading' }).label).toBe('Live data: OpenRouter models · leaderboard from visitor votes')
  })

  it('lights with the fetch time when the model list is live and the board loaded, even with 0 ballots', () => {
    expect(liveIndicator(catalogue('live'), false, ready)).toMatchObject({
      state: 'live',
      label: `Live data: OpenRouter models · leaderboard from visitor votes · fetched ${clock(FETCHED)}`,
    })
  })

  it('does not light for a cached or built-in model list', () => {
    expect(liveIndicator(catalogue('cached'), false, ready).state).toBe('failed')
    expect(liveIndicator(catalogue('fallback'), false, ready).label).toBe('Live data unavailable: OpenRouter models')
  })

  it('reads failed when either fetch failed', () => {
    expect(liveIndicator(null, true, { state: 'loading' }).state).toBe('failed')
    expect(liveIndicator(catalogue('live'), false, { state: 'error', message: 'x' })).toMatchObject({
      state: 'failed',
      label: 'Live data unavailable: leaderboard from visitor votes',
    })
  })
})

describe('nothing canned is bundled', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap(name => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : [path]
    })
  const code = [...files('src'), ...files('netlify')]

  it('has no data files and no import from tests or fixtures in src or netlify', () => {
    expect(code.filter(path => /\.(json|csv|ndjson)$/.test(path))).toEqual([])
    for (const path of code.filter(p => /\.(ts|tsx)$/.test(p))) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/from ['"][^'"]*(tests|fixtures)\//)
    }
  })
})
