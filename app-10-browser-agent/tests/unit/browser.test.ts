import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { currentHost, runStep } from '../../netlify/shared/browser'
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
