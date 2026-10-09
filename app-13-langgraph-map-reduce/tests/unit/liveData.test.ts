import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clock, liveIndicator } from '../../src/lib/liveData'

const AT = new Date(2026, 9, 9, 14, 32).getTime()
const ARTICLE = 'Apollo 11 was the first crewed mission to land on the Moon.'

describe('the live-data chip', () => {
  it('is idle and names Wikipedia and pasted text before anything is loaded', () => {
    expect(liveIndicator('', null)).toMatchObject({ state: 'idle', label: 'Live data: Wikipedia · or your pasted text', title: 'en.wikipedia.org' })
    expect(liveIndicator('', { kind: 'loading' }).state).toBe('idle')
  })

  it('lights with the fetch time while the box still holds the article Wikipedia returned', () => {
    expect(liveIndicator(ARTICLE, { kind: 'loaded', text: ARTICLE, at: AT })).toEqual({
      state: 'live',
      label: `Live data: Wikipedia · fetched ${clock(AT)}`,
      title: 'en.wikipedia.org',
    })
  })

  it('reads "Your text" once the article is edited or replaced, and for pasted text', () => {
    const edited = liveIndicator(`${ARTICLE} Edited.`, { kind: 'loaded', text: ARTICLE, at: AT })
    expect(edited.label).toBe('Your text')
    expect(liveIndicator('pasted notes', null).label).toBe('Your text')
    expect(edited.label).not.toContain('Live data')
  })

  it('reads failed, naming Wikipedia, when the fetch failed and the box is empty', () => {
    expect(liveIndicator('', { kind: 'failed' })).toMatchObject({ state: 'failed', label: 'Live data unavailable: Wikipedia' })
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
