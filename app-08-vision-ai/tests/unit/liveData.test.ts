import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CommonsImage } from '../../src/lib/commons'
import { clock, liveIndicator } from '../../src/lib/liveData'

const AT = new Date(2026, 9, 9, 14, 32).getTime()
const commons = { title: 'File:Sign.jpg', fileName: 'Sign.jpg' } as CommonsImage

describe('the live-data chip', () => {
  it('is idle and names Commons and the visitor\'s own file before a picture is loaded', () => {
    expect(liveIndicator({ loaded: [], at: null, commonsFailed: false })).toMatchObject({
      state: 'idle',
      label: 'Live data: Wikimedia Commons · or your own file',
    })
  })

  it('lights as live data, with the fetch time, for a Commons pick', () => {
    expect(liveIndicator({ loaded: [commons], at: AT, commonsFailed: false })).toMatchObject({
      state: 'live',
      label: `Live data: Wikimedia Commons · fetched ${clock(AT)}`,
      title: 'commons.wikimedia.org, upload.wikimedia.org',
    })
  })

  it('reads "Your file", never live data, for the visitor\'s own picture', () => {
    const out = liveIndicator({ loaded: [null], at: AT, commonsFailed: false })
    expect(out.label).toBe(`Your file · read ${clock(AT)}`)
    expect(out.label).not.toContain('Live data')
  })

  it('names both when a comparison mixes a Commons pick and an upload', () => {
    expect(liveIndicator({ loaded: [commons, null], at: AT, commonsFailed: false }).label).toBe(`Live data: Wikimedia Commons + your file · ${clock(AT)}`)
  })

  it('reads failed when Commons failed and no picture is loaded, but not once a picture is', () => {
    expect(liveIndicator({ loaded: [], at: null, commonsFailed: true })).toMatchObject({ state: 'failed', label: 'Live data unavailable: Wikimedia Commons' })
    expect(liveIndicator({ loaded: [null], at: AT, commonsFailed: true }).state).toBe('live')
  })
})

describe('nothing canned is bundled', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap(name => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : [path]
    })
  const code = [...files('src'), ...files('netlify')]

  it('has no data files, no bundled images, and no import from tests or fixtures in src or netlify', () => {
    expect(code.filter(path => /\.(json|csv|ndjson|png|jpe?g|webp|gif)$/.test(path))).toEqual([])
    for (const path of code.filter(p => /\.(ts|tsx)$/.test(p))) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/from ['"][^'"]*(tests|fixtures)\//)
    }
  })
})
