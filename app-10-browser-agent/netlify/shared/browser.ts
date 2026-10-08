import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from '@browserbasehq/sdk'
import type { Page } from 'playwright-core'
import type { BotStep, ObservedPage } from '../../src/types'
import { isAllowedHost } from './domains'

export const MAX_STEP_MS = 3_000
const MAX_EXCERPT = 4_000

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

export async function pageSnapshot(page: Page): Promise<ObservedPage> {
  const [title, body] = await Promise.all([
    page.title().catch(() => ''),
    page.locator('body').innerText({ timeout: 1_000 }).catch(() => ''),
  ])
  return { url: page.url(), title, excerpt: body.trim().slice(0, MAX_EXCERPT) }
}

function targetLocator(page: Page, target: string) {
  const normalized = target.toLowerCase()
  // "search" alone names the box. Inside "search button" it must not match, or the click lands in the box.
  if (['search input', 'search field', 'search box', 'search bar'].some((name) => normalized.includes(name)) || normalized === 'search') {
    return page.locator('textarea[name="q"], input[name="q"], input[aria-label*="Search" i]').first()
  }
  if (normalized.includes('search button') || normalized === 'search') {
    return page.getByRole('button', { name: /search/i }).first()
  }
  return page.getByText(target, { exact: false }).first()
}

/**
 * Runs one planned step on the live page and returns a short, factual detail. Throws an
 * ExecutionError with curated copy when the page does not allow the step.
 */
export async function runStep(page: Page, step: BotStep, domains: string[]): Promise<string> {
  switch (step.action) {
    case 'navigate': {
      await acting(page.goto(step.url ?? '', { waitUntil: 'domcontentloaded' }), 'The page could not be loaded.')
      const landed = new URL(page.url())
      if (landed.protocol !== 'https:' && landed.protocol !== 'http:') {
        throw new ExecutionError('The browser did not reach a web page.')
      }
      if (!isAllowedHost(landed.hostname, domains)) {
        throw new ExecutionError(`The page redirected to ${landed.hostname}, which is outside the allowed sites.`)
      }
      return `Opened ${landed.hostname}.`
    }
    case 'find': {
      const locator = targetLocator(page, step.target)
      if (await locator.count() > 0) return `Found ${step.target}.`
      const observed = await pageSnapshot(page)
      const needle = step.target.toLowerCase()
      const haystack = `${observed.title}\n${observed.excerpt}`.toLowerCase()
      if (haystack.includes(needle) || (needle.includes('title') && observed.title)) {
        return `Found ${step.target} in the page text.`
      }
      throw new ExecutionError(`The target was not found: ${step.target}.`)
    }
    case 'click': {
      const locator = targetLocator(page, step.target)
      if (await locator.count() === 0) throw new ExecutionError(`The target was not found: ${step.target}.`)
      await acting(locator.click(), `${step.target} could not be clicked.`)
      return `Clicked ${step.target}.`
    }
    case 'type': {
      const locator = targetLocator(page, step.target)
      if (await locator.count() === 0) throw new ExecutionError(`No text input was found for ${step.target}.`)
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
