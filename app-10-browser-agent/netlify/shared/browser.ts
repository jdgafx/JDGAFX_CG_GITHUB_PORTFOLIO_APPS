import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from '@browserbasehq/sdk'
import type { Locator, Page } from 'playwright-core'
import type { BotStep, ObservedPage } from '../../src/types'

/** Longest one browser action may take. A step that runs longer fails with a curated message. */
const MAX_STEP_MS = 3_000
const MAX_EXCERPT = 4_000
/** A region read returns the text of this many matching elements at most, and takes at most REGION_MS. */
const MAX_REGION_ITEMS = 10
const REGION_MS = 2_000

/** A run failure whose message is curated copy the browser may show. */
export class ExecutionError extends Error {}

/** Rejects with a curated message when the promise is too slow. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExecutionError(message)), timeoutMs)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/** Acts on the page under the step time limit. Any failure becomes one curated message. */
async function acting(action: Promise<unknown>, failure: string): Promise<void> {
  const slow = `${failure} It took too long.`
  try {
    await withTimeout(action, MAX_STEP_MS, slow)
  } catch (error) {
    throw error instanceof ExecutionError && error.message === slow ? error : new ExecutionError(failure)
  }
}

/** Counts the elements a locator matches, under the step time limit. */
async function countOf(locator: Locator): Promise<number> {
  return withTimeout(locator.count(), MAX_STEP_MS, 'The page did not answer in time.')
}

/** The host the page is on now, or null when the page is not an http or https address. */
export function currentHost(page: Page): string | null {
  try {
    const url = new URL(page.url())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.hostname : null
  } catch {
    return null
  }
}

/**
 * The visible text of the first matches of a region, one element per line. When an element spans
 * several lines, the elements are set apart by a blank line so they can still be told apart.
 */
export function regionText(texts: string[]): string {
  // Empty elements (Wikipedia has empty paragraphs) are dropped before the first ten are taken.
  const items = texts
    .map((text) => text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'))
    .filter(Boolean)
    .slice(0, MAX_REGION_ITEMS)
  return items.join(items.some((item) => item.includes('\n')) ? '\n\n' : '\n')
}

/** The text of a CSS region, or an empty string when nothing matches, the selector is not valid or the page is slow. */
async function readRegion(page: Page, selector: string): Promise<string> {
  try {
    return regionText(await withTimeout(page.locator(selector).allInnerTexts(), REGION_MS, 'The region did not read in time.'))
  } catch {
    return ''
  }
}

/**
 * What the page shows now. With a selector, the excerpt is the text of the matching elements and
 * `region` names the selector. Without one, or when nothing matches, the excerpt is the page text.
 */
export async function pageSnapshot(page: Page, selector?: string): Promise<ObservedPage> {
  const title = withTimeout(page.title(), MAX_STEP_MS, 'The page title did not load in time.').catch(() => '')
  const region = selector ? await readRegion(page, selector) : ''
  const text = region || await page.locator('body').innerText({ timeout: 1_000 }).catch(() => '')
  return {
    url: page.url(),
    title: await title,
    excerpt: text.trim().slice(0, MAX_EXCERPT),
    ...(region ? { region: selector } : {}),
  }
}

function targetLocator(page: Page, target: string) {
  const normalized = target.toLowerCase()
  // "search" alone names the box. Inside "search button" it must not match, or the click lands in the box.
  if (['search input', 'search field', 'search box', 'search bar'].some((name) => normalized.includes(name)) || normalized === 'search') {
    return page.locator('textarea[name="q"], input[name="q"], input[aria-label*="Search" i]').first()
  }
  if (normalized.includes('search button')) {
    return page.getByRole('button', { name: /search/i }).first()
  }
  return page.getByText(target, { exact: false }).first()
}

/**
 * Runs one planned step on the live page and returns a short, factual detail. Throws an
 * ExecutionError with curated copy when the step cannot be done. The caller checks the host the
 * page lands on after every step, before it reads the page.
 */
export async function runStep(page: Page, step: BotStep): Promise<string> {
  switch (step.action) {
    case 'navigate': {
      await acting(page.goto(step.url ?? '', { waitUntil: 'domcontentloaded' }), 'The page could not be loaded.')
      const host = currentHost(page)
      if (host === null) throw new ExecutionError('The browser did not reach a web page.')
      return `Opened ${host}.`
    }
    case 'find': {
      const locator = targetLocator(page, step.target)
      if (await countOf(locator) > 0) return `Found ${step.target}.`
      const observed = await pageSnapshot(page)
      const needle = step.target.toLowerCase()
      const haystack = `${observed.title}\n${observed.excerpt}`.toLowerCase()
      if (haystack.includes(needle) || (/\bpage title\b/.test(needle) && observed.title.trim() !== '')) {
        return `Found ${step.target} in the page text.`
      }
      throw new ExecutionError(`The target was not found: ${step.target}.`)
    }
    case 'click': {
      const locator = targetLocator(page, step.target)
      if (await countOf(locator) === 0) throw new ExecutionError(`The target was not found: ${step.target}.`)
      await acting(locator.click(), `${step.target} could not be clicked.`)
      return `Clicked ${step.target}.`
    }
    case 'type': {
      const locator = targetLocator(page, step.target)
      if (await countOf(locator) === 0) throw new ExecutionError(`No text input was found for ${step.target}.`)
      const value = step.value ?? ''
      await acting(locator.fill(value), `${step.target} could not take the text.`)
      // Outcome check: the field must now hold exactly what the plan typed.
      const shown = await locator.inputValue({ timeout: 1_000 }).catch(() => null)
      if (shown !== value) throw new ExecutionError(`${step.target} does not hold the text that was typed.`)
      return `Typed ${value.length} characters into ${step.target}.`
    }
    default:
      // extract and verify read the observed page. The planner's claimed values are never used.
      return `Observed the page for ${step.target}.`
  }
}

/** The message the browser may see for a failure. Provider bodies, URLs and stack traces stay in the log. */
export function browserMessage(error: unknown): string {
  if (error instanceof ExecutionError) return error.message
  if (error instanceof APIUserAbortError || error instanceof APIConnectionTimeoutError) {
    return 'The browser provider did not answer in time. Try again in a moment.'
  }
  if (error instanceof APIConnectionError) return 'Could not reach the browser provider. Try again in a moment.'
  if (error instanceof APIError) {
    if (error.status === 402) return 'The browser provider is out of credit, so no session was started.'
    if (error.status === 429) return 'The browser provider is rate limiting sessions. Try again shortly.'
    if (error.status !== undefined && error.status >= 500) return 'The browser provider failed. Try again in a moment.'
    console.error(`Browserbase rejected a request with HTTP ${error.status ?? 'unknown'}`)
    return 'The browser provider rejected the session request.'
  }
  console.error('Browser run failed:', error instanceof Error ? error.name : 'unknown error')
  return 'The browser run failed before it finished. Try again in a moment.'
}
