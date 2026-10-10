export const MAX_TASK_CHARS = 500

/**
 * The default allowlist, shown on the page with a line on what each site is good for. The hosts
 * mirror the default in netlify/shared/domains.ts, and a test keeps the two equal. When
 * ALLOWED_DOMAINS is set, the server enforces that list instead, and the page does not show it.
 */
export const ALLOWED_SITE_NOTES = [
  { host: 'google.com', note: 'Search home page' },
  { host: 'www.google.com', note: 'Search and results pages' },
  { host: 'flights.google.com', note: 'Google Flights' },
  { host: 'en.wikipedia.org', note: 'English Wikipedia articles' },
  { host: 'news.ycombinator.com', note: 'Hacker News front page' },
]

export const ALLOWED_SITES = ALLOWED_SITE_NOTES.map((site) => site.host)

/** The task the Try it button runs. It is one of the examples, and the page it reads changes all day, so the result is live. */
export const TRY_TASK = 'Open news.ycombinator.com and report the top three story titles'

/** Example tasks. Each one names only sites on the default allowlist, and the first three read a live, changing page. */
export const PRESETS = [
  'Open news.ycombinator.com and report the top three story titles',
  'Open news.ycombinator.com/newest and report the three newest story titles',
  'Open en.wikipedia.org and report the title of today\'s featured article',
  'Open en.wikipedia.org/wiki/Hubble_Space_Telescope and report its launch date',
  'Open google.com and report the page title',
]
