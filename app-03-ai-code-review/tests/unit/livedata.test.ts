import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { clock, liveData } from '../../src/lib/livedata'

const base = { mode: 'file' as const, fetchedAt: null, failed: false, ownCode: false }

describe('liveData', () => {
  it('is idle before anything is fetched, naming the source', () => {
    expect(liveData(base)).toEqual({ state: 'idle', text: 'Live data: your code + GitHub', title: 'api.github.com' })
  })

  it('lights up only once a fetch was parsed, with its time', () => {
    const at = new Date(2026, 9, 9, 14, 32)
    expect(liveData({ ...base, fetchedAt: at })).toEqual({ state: 'live', text: 'Live data: GitHub · fetched 14:32', title: 'api.github.com' })
    expect(clock(new Date(2026, 9, 9, 9, 5))).toBe('09:05')
  })

  it('goes to failed on a failed fetch, whatever was loaded before', () => {
    expect(liveData({ ...base, fetchedAt: new Date(), failed: true })).toMatchObject({ state: 'failed', text: 'Live data unavailable: GitHub' })
  })

  it('labels pasted or edited code as the visitor\'s own, and a pull request fetch as live', () => {
    expect(liveData({ ...base, ownCode: true })).toMatchObject({ state: 'idle', text: 'Your code' })
    expect(liveData({ ...base, mode: 'pr', fetchedAt: new Date(2026, 9, 9, 8, 0) })).toMatchObject({ state: 'live', text: 'Live data: GitHub · fetched 08:00' })
  })
})

describe('no canned data reaches a visitor', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
  const files = [...walk('src'), ...walk('netlify')]

  it('ships no data files in src or netlify, only code and styles', () => {
    expect(files.filter((f) => /\.(json|csv|ndjson|txt)$/.test(f))).toEqual([])
  })

  it('has no sample, demo or canned result constants in the code a visitor runs', () => {
    const offenders = files.filter((f) => /\.(ts|tsx)$/.test(f)).filter((f) => /\b(?:SAMPLE|DEMO|MOCK|CANNED|FAKE)_[A-Z_]+\b|\b(?:sampleReview|demoReview|mockReview|cannedReview|fakeResult)\b/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
