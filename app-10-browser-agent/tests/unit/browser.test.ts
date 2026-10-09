import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { currentHost, pageSnapshot, regionText, runStep } from '../../netlify/shared/browser'
import type { BotStep } from '../../src/types'

/** A page at the given address whose text search finds nothing. */
function addressed(url: string): Page {
  return { url: () => url } as unknown as Page
}

/** A page with the given title and body text, where the planned target is never found as an element. */
function pageWith(title: string, text = 'Nothing relevant here'): Page {
  const nothing = { count: async () => 0, first: () => nothing }
  return {
    url: () => 'https://www.google.com/',
    title: async () => title,
    getByText: () => nothing,
    getByRole: () => nothing,
    locator: () => ({ ...nothing, innerText: async () => text }),
  } as unknown as Page
}

describe('currentHost', () => {
  it('returns the host of a web address, and null for any other address', () => {
    expect(currentHost(addressed('https://www.google.com/search?q=x'))).toBe('www.google.com')
    expect(currentHost(addressed('http://example.com:8080/'))).toBe('example.com')
    expect(currentHost(addressed('about:blank'))).toBeNull()
    expect(currentHost(addressed('not a url'))).toBeNull()
  })
})

describe('runStep', () => {
  it('reports the host a navigate step landed on, and leaves the allowlist check to the caller', async () => {
    const page = { url: () => 'https://example.com/', goto: async () => null } as unknown as Page
    const navigate: BotStep = { action: 'navigate', target: 'Example', thought: 'Open it.', url: 'https://example.com/' }
    await expect(runStep(page, navigate)).resolves.toBe('Opened example.com.')
  })

  it('counts a page title as found only when the title is not blank', async () => {
    const find: BotStep = { action: 'find', target: 'page title', thought: 'Look for the title.' }
    await expect(runStep(pageWith('Google'), find)).resolves.toBe('Found page title in the page text.')
    await expect(runStep(pageWith('   '), find)).rejects.toMatchObject({ message: 'The target was not found: page title.' })
  })
})

/** A page whose region locator returns the given element texts, and whose body text is `body`. */
function regionPage(texts: string[] | Error, body = 'Whole page text'): Page {
  return {
    url: () => 'https://news.ycombinator.com/',
    title: async () => 'Hacker News',
    locator: (selector: string) => ({
      allInnerTexts: async () => {
        if (texts instanceof Error) throw texts
        return selector === '.titleline > a' ? texts : []
      },
      innerText: async () => body,
    }),
  } as unknown as Page
}

describe('regionText', () => {
  it('puts one element per line and keeps only the first ten', () => {
    const titles = Array.from({ length: 12 }, (_, i) => `Story ${i + 1}`)
    expect(regionText(titles).split('\n')).toEqual(titles.slice(0, 10))
  })

  it('collapses spaces and blank lines inside an element, and sets multi-line elements apart', () => {
    expect(regionText([' Star\n owner / repo\n\nA  tool \n  C++  1,200 ', 'next / repo\n\n\nOther'])).toBe(
      'Star\nowner / repo\nA tool\nC++ 1,200\n\nnext / repo\nOther',
    )
  })

  it('skips elements with no visible text', () => {
    expect(regionText(['', '  \n ', 'Kept'])).toBe('Kept')
  })
})

describe('pageSnapshot', () => {
  it('reads the page text when no selector is given', async () => {
    await expect(pageSnapshot(regionPage(['A']))).resolves.toEqual({
      url: 'https://news.ycombinator.com/', title: 'Hacker News', excerpt: 'Whole page text',
    })
  })

  it('reads the text of the region and names it', async () => {
    await expect(pageSnapshot(regionPage(['First', 'Second']), '.titleline > a')).resolves.toEqual({
      url: 'https://news.ycombinator.com/', title: 'Hacker News', excerpt: 'First\nSecond', region: '.titleline > a',
    })
  })

  it('falls back to the page text, with no region named, when nothing matches or the selector is invalid', async () => {
    const nothing = await pageSnapshot(regionPage(['First']), '.missing')
    expect(nothing.excerpt).toBe('Whole page text')
    expect(nothing).not.toHaveProperty('region')
    const invalid = await pageSnapshot(regionPage(new Error('bad selector')), '.titleline > a')
    expect(invalid.excerpt).toBe('Whole page text')
    expect(invalid).not.toHaveProperty('region')
  })

  it('caps the excerpt at 4,000 characters', async () => {
    const page = regionPage(['x'.repeat(5_000)], 'y')
    expect((await pageSnapshot(page, '.titleline > a')).excerpt).toHaveLength(4_000)
  })
})

