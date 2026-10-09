import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { liveDataView } from '../../src/lib/liveData'
import type { Source } from '../../src/types'

const wiki: Source = { n: 1, title: 'Python', site: 'Wikipedia', url: 'https://x.test', snippet: 'A language.' }
const hn: Source = { n: 2, title: 'Story', site: 'Hacker News', url: 'https://x.test', snippet: 'Story.' }
const at = new Date(2026, 9, 9, 14, 5)

describe('liveDataView', () => {
  it('is idle before and during retrieval', () => {
    expect(liveDataView({ status: 'idle' }, null)).toMatchObject({ state: 'idle', text: 'Live data: Wikipedia + Hacker News' })
    expect(liveDataView({ status: 'working' }, null).state).toBe('idle')
  })

  it('lights up only when retrieval completed with sources, naming the sites that answered and the fetch time', () => {
    expect(liveDataView({ status: 'complete', sources: [wiki, hn] }, at)).toMatchObject({ state: 'live', text: 'Live data: Wikipedia + Hacker News · fetched 14:05' })
    expect(liveDataView({ status: 'complete', sources: [wiki] }, at).text).toBe('Live data: Wikipedia · fetched 14:05')
  })

  it('fails on an error or when nothing was found', () => {
    expect(liveDataView({ status: 'error' }, null)).toMatchObject({ state: 'failed', text: 'Live data unavailable: Wikipedia + Hacker News' })
    expect(liveDataView({ status: 'complete', sources: [] }, at).state).toBe('failed')
  })
})

describe('no canned data', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap(name => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]))
  it('has no sample, demo or mock data in src or netlify', () => {
    const hits = [...files('src'), ...files('netlify')].filter(file => /\b(sample|demo|mock|canned|fixture)\w*\b/i.test(readFileSync(file, 'utf8')))
    expect(hits).toEqual([])
  })
})
