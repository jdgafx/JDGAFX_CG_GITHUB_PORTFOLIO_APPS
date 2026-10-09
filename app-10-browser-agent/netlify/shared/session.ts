import chromium from '@sparticuz/chromium'
import { chromium as playwright, type Browser } from 'playwright-core'
import { ExecutionError, withTimeout } from './browser'

/** Longest the browser may take to start. The first start after a cold function unpacks Chromium into /tmp. */
export const LAUNCH_TIMEOUT_MS = 12_000
/** Longest a page open or a browser close may take. */
export const BROWSER_TIMEOUT_MS = 7_000

export interface Launched {
  browser: Browser
  /** The Chromium version the browser reports, such as 153.0.8010.0. */
  version: string
  /** Milliseconds spent unpacking the Chromium binary: large on a cold function, near zero when it is already in /tmp. */
  unpackMs: number
}

/**
 * Starts headless Chromium inside this function. A start that arrives after the limit is closed as soon as it
 * resolves, so no browser is left running with nothing using it.
 */
export async function launchBrowser(): Promise<Launched> {
  const started = Date.now()
  let abandoned = false
  const starting = (async () => {
    const executablePath = await chromium.executablePath()
    const unpackMs = Date.now() - started
    const browser = await playwright.launch({ executablePath, args: chromium.args, headless: true })
    return { browser, unpackMs }
  })()
  void starting.then(
    (late) => {
      if (abandoned) void late.browser.close().catch(() => undefined)
    },
    () => undefined,
  )
  try {
    const { browser, unpackMs } = await withTimeout(starting, LAUNCH_TIMEOUT_MS, 'The browser did not start in time.')
    return { browser, version: browser.version(), unpackMs }
  } catch (error) {
    abandoned = true
    if (error instanceof ExecutionError) throw error
    // The reason stays in the function log. The visitor gets a plain sentence.
    console.error('Browser launch failed:', error instanceof Error ? error.message.slice(0, 300) : 'unknown error')
    throw new ExecutionError('The browser could not start. Try again in a moment.')
  }
}

/** Closes the browser under the time limit. Returns false when it does not close in time. */
export async function closeBrowser(browser: Browser): Promise<boolean> {
  try {
    await withTimeout(browser.close(), BROWSER_TIMEOUT_MS, 'The browser did not close in time.')
    return true
  } catch {
    return false
  }
}
