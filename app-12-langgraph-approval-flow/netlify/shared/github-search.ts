import { clip } from '../../src/lib/limits'
import type { SearchedIssue } from './duplicate-rank'
import { isRecord } from './guard'

/**
 * The server's one call to GitHub: the issue search that finds duplicate candidates. GITHUB_TOKEN is read from
 * the environment when it is set, which lifts the search limit from 10 to 30 requests a minute. Without a token
 * the limit is 10 a minute for the whole address, and Netlify functions share addresses, so a busy hour can
 * use it up. The failure then names the limit and the page carries on without a duplicate check.
 */
const ENDPOINT = 'https://api.github.com/search/issues'
export const SEARCH_TIMEOUT_MS = 5_000
const PER_PAGE = 30
const MAX_BODY_CHARS = 1500
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

/** A failure whose message is written for the visitor. `limited` is true for a rate limit. */
export class SearchError extends Error {
  constructor(
    message: string,
    readonly limited = false,
  ) {
    super(message)
    this.name = 'SearchError'
  }
}

/** Searches one repo's issues, open and closed. Tests pass a fake in its place. */
export type SearchFn = (query: string, signal: AbortSignal) => Promise<SearchedIssue[]>

/** The plain message for a 403 or 429 from the search API. Reads the reset time from the headers. */
export function limitMessage(headers: Headers, hasToken: boolean, nowMs: number = Date.now()): string {
  const quota = hasToken ? '30 searches a minute' : '10 searches a minute without a token'
  const wait = Number(headers.get('retry-after'))
  const reset = Number(headers.get('x-ratelimit-reset'))
  let seconds: number | null = null
  if (Number.isFinite(wait) && wait > 0) seconds = Math.ceil(wait)
  else if (headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset) && reset > 0) {
    seconds = Math.max(1, Math.ceil((reset * 1000 - nowMs) / 1000))
  }
  const when = seconds === null ? 'Try again in a minute.' : `Try again in about ${seconds} second${seconds === 1 ? '' : 's'}.`
  return `GitHub's search limit (${quota}) is used up. ${when}`
}

/** One search item as an issue, or null for a pull request or an item that does not have the fields. */
export function searchedIssueFrom(item: unknown): SearchedIssue | null {
  if (!isRecord(item) || 'pull_request' in item) return null
  const { number, title, html_url: url, state, created_at: created, updated_at: updated } = item
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || typeof title !== 'string' || !title.trim()) return null
  if (typeof url !== 'string' || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(url)) return null
  if (state !== 'open' && state !== 'closed') return null
  if (typeof created !== 'string' || !ISO.test(created) || typeof updated !== 'string' || !ISO.test(updated)) return null
  return {
    number,
    title: title.trim(),
    body: typeof item.body === 'string' ? clip(item.body, MAX_BODY_CHARS) : '',
    htmlUrl: url,
    state,
    stateReason: typeof item.state_reason === 'string' ? item.state_reason : null,
    createdAt: created,
    updatedAt: updated,
  }
}

export function parseSearch(json: unknown): SearchedIssue[] {
  const items = isRecord(json) && Array.isArray(json.items) ? json.items : []
  return items.map(searchedIssueFrom).filter((item): item is SearchedIssue => item !== null)
}

async function exchange(url: string, headers: Record<string, string>, signal: AbortSignal, hasToken: boolean): Promise<SearchedIssue[]> {
  let response: Response
  try {
    response = await fetch(url, { headers, signal })
  } catch {
    throw new SearchError('GitHub could not be reached for the duplicate search.')
  }
  if (response.status === 403 || response.status === 429) throw new SearchError(limitMessage(response.headers, hasToken), true)
  if (response.status === 422 || response.status === 404) throw new SearchError('GitHub would not search this repository for duplicates.')
  if (!response.ok) throw new SearchError(`GitHub's search answered with an error (${response.status}).`)
  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new SearchError('GitHub sent a search reply that could not be read.')
  }
  return parseSearch(json)
}

/**
 * One search, bounded by its own timer and by the run's signal. The timer settles a race with the whole
 * exchange, the body read included, so a stalled reply is cut at the limit.
 */
export const searchIssues: SearchFn = async (query, signal) => {
  const token = process.env.GITHUB_TOKEN?.trim()
  const params = new URLSearchParams({ q: query, per_page: String(PER_PAGE) })
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'graphgate-portfolio-demo',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const deadlines = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new SearchError('GitHub did not answer the duplicate search in time.'))
    }, SEARCH_TIMEOUT_MS)
    onAbort = () => {
      controller.abort()
      reject(new SearchError('The duplicate search was cut off when the run ran out of time.'))
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  const reply = exchange(`${ENDPOINT}?${params.toString()}`, headers, controller.signal, Boolean(token))
  try {
    return await Promise.race([reply, deadlines])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
    reply.catch(() => {})
    deadlines.catch(() => {})
  }
}
