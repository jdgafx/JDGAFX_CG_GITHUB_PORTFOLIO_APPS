import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clock, liveData } from '../../src/lib/liveData'

const AT = Date.UTC(2026, 9, 9, 14, 32)
const wiki = { source: { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Expo_98' } }

describe('the live-data chip', () => {
  it('is idle and names every source before a document is loaded', () => {
    expect(liveData(null, null, null)).toMatchObject({ state: 'idle', label: 'Live data: Wikipedia · arXiv · your file' })
  })

  it('lights with the source and fetch time once a Wikipedia article is parsed', () => {
    const out = liveData(wiki, AT, null)
    expect(out.state).toBe('live')
    expect(out.label).toBe(`Live data: Wikipedia · fetched ${clock(AT)}`)
    expect(out.title).toBe('en.wikipedia.org')
    expect(liveData({ source: { label: 'Wikipedia, first 12 sections', url: null } }, AT, null).label).toContain('Live data: Wikipedia')
  })

  it('lights for arXiv, and says "Your file" for an upload, which is not a fetch', () => {
    expect(liveData({ source: { label: 'arXiv', url: null } }, AT, null).label).toBe(`Live data: arXiv · fetched ${clock(AT)}`)
    const file = liveData({ source: { label: 'Your file', url: null } }, AT, null)
    expect(file).toMatchObject({ state: 'live', label: `Your file · read ${clock(AT)}` })
    expect(file.label).not.toContain('Live data')
  })

  it('reads failed, naming the source, when the load failed and nothing is loaded', () => {
    expect(liveData(null, null, 'wikipedia')).toMatchObject({ state: 'failed', label: 'Live data unavailable: Wikipedia' })
    expect(liveData(null, null, 'arxiv').label).toBe('Live data unavailable: arXiv')
    expect(liveData(null, null, 'file').state).toBe('failed')
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
