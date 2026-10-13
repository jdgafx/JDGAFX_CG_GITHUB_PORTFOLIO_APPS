import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CommonsImage } from '../../src/lib/commons'
import { clock, liveIndicator, loadedSlots } from '../../src/lib/liveData'

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
    expect(liveIndicator({ loaded: [commons, null], at: AT, commonsFailed: false }).label).toBe(`Live data: Wikimedia Commons + your file · fetched ${clock(AT)}`)
  })

  it('reads failed when Commons failed and no picture is loaded, but not once a picture is', () => {
    expect(liveIndicator({ loaded: [], at: null, commonsFailed: true })).toMatchObject({ state: 'failed', label: 'Live data unavailable: Wikimedia Commons' })
    expect(liveIndicator({ loaded: [null], at: AT, commonsFailed: true }).state).toBe('live')
  })
})

describe('the live listing on load', () => {
  it('lights the chip as live data, with the count and the time, as soon as the picker lists Commons pictures', () => {
    expect(liveIndicator({ loaded: [], at: null, commonsFailed: false, listing: { count: 12, at: AT } })).toMatchObject({
      state: 'live',
      label: `Live data: Wikimedia Commons · 12 pictures listed ${clock(AT)}`,
      title: 'commons.wikimedia.org, upload.wikimedia.org',
    })
    expect(liveIndicator({ loaded: [], at: null, commonsFailed: false, listing: { count: 1, at: AT } }).label).toContain('1 picture listed')
  })

  it('stays idle with no listing, and reads failed when Commons failed, whatever an earlier listing said', () => {
    expect(liveIndicator({ loaded: [], at: null, commonsFailed: false, listing: null }).state).toBe('idle')
    expect(liveIndicator({ loaded: [], at: null, commonsFailed: true, listing: { count: 12, at: AT } }).state).toBe('failed')
  })

  it('gives way to the picture once one is loaded', () => {
    expect(liveIndicator({ loaded: [commons], at: AT, commonsFailed: false, listing: { count: 12, at: AT } }).label).toBe(`Live data: Wikimedia Commons · fetched ${clock(AT)}`)
  })
})

describe('which pictures the chip reads', () => {
  it('leaves out a picture that came out of a recording: a replay is never live data', () => {
    expect(loadedSlots({ hasA: true, hasB: false, sourceA: commons, sourceB: null, recordedA: true })).toEqual([])
    expect(loadedSlots({ hasA: true, hasB: false, sourceA: commons, sourceB: null, recordedA: false })).toEqual([commons])
    expect(loadedSlots({ hasA: true, hasB: true, sourceA: commons, sourceB: null, recordedA: false })).toEqual([commons, null])
    expect(loadedSlots({ hasA: false, hasB: false, sourceA: null, sourceB: null, recordedA: false })).toEqual([])
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
