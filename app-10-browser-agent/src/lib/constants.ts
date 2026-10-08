export const MAX_TASK_CHARS = 500

/**
 * The default allowlist, shown on the page. It mirrors the default in netlify/shared/domains.ts, and a
 * test keeps the two equal. When BROWSERBASE_ALLOWED_DOMAINS is set, the server enforces that list instead,
 * and the page does not show it.
 */
export const ALLOWED_SITES = ['google.com', 'www.google.com', 'flights.google.com']

/** Example tasks. Each one names only sites on the default allowlist. */
export const PRESETS = [
  'Open google.com and report the page title',
  'Search google.com for Browserbase and report the title of the results page',
  'Open flights.google.com and report the page title',
  'Open google.com and report the first lines of page text',
]
