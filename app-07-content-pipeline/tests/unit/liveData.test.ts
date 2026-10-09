import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clock, liveIndicator } from '../../src/lib/liveData'
import { formatSourcePack } from '../../netlify/shared/sourcepack'

const AT = new Date(2026, 9, 9, 14, 32).getTime()
const wiki = { n: 1, kind: 'wikipedia' as const, title: 'Apollo 11', url: 'https://en.wikipedia.org/wiki/Apollo_11', summary: 'First crewed Moon landing.' }
const hn = { n: 2, kind: 'hackernews' as const, title: 'Apollo guidance', url: 'https://news.ycombinator.com/item?id=1', summary: '', points: 120 }
const base = { sources: undefined, at: null, contentType: 'Blog Post', failedAtSources: false }

describe('the live-data chip', () => {
  it('is idle before the Sources step, naming the providers searched for the format', () => {
    expect(liveIndicator(base)).toMatchObject({ state: 'idle', label: 'Live data: Wikipedia + Hacker News', title: 'en.wikipedia.org, hn.algolia.com' })
    expect(liveIndicator({ ...base, contentType: 'Marketing Copy' }).label).toBe('Live data: Wikipedia')
  })

  it('lights with the providers that delivered once sources parse', () => {
    const both = formatSourcePack({ sources: [wiki, hn], notes: [] })
    expect(liveIndicator({ ...base, sources: both, at: AT })).toMatchObject({ state: 'live', label: `Live data: Wikipedia + Hacker News · fetched ${clock(AT)}` })
    const only = formatSourcePack({ sources: [wiki], notes: ['Hacker News did not answer in time.'] })
    expect(liveIndicator({ ...base, sources: only, at: AT })).toMatchObject({ state: 'live', label: `Live data: Wikipedia · fetched ${clock(AT)}`, title: 'en.wikipedia.org' })
  })

  it('reads failed when the Sources step finished empty, or failed', () => {
    const none = formatSourcePack({ sources: [], notes: ['Wikipedia did not answer in time.'] })
    expect(liveIndicator({ ...base, sources: none, at: AT })).toMatchObject({ state: 'failed', label: 'Live data unavailable: Wikipedia + Hacker News' })
    expect(liveIndicator({ ...base, failedAtSources: true }).state).toBe('failed')
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
