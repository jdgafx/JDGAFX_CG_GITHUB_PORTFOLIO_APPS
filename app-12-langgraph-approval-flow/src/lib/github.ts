import { clip, BODY_MAX_LENGTH, LABEL_MAX_LENGTH, LABELS_MAX, TITLE_MAX_LENGTH } from './limits'
import { AUTHOR_ASSOCIATIONS, type AuthorAssociation, type IssueInput } from '../types'

/**
 * Live GitHub issues, fetched from the browser. api.github.com allows cross-origin reads, and an
 * anonymous visitor gets 60 requests an hour from their own address. The server never calls GitHub:
 * Netlify functions share addresses, so they would share one small quota.
 */
const API = 'https://api.github.com'
const REQUEST_MS = 10_000
/** Pull requests share the issues endpoint, so more are asked for than are shown. */
const PAGE_SIZE = 100
export const LIST_SIZE = 25

export interface RepoRef {
  owner: string
  repo: string
}

/** A failure whose message is written for the visitor. */
export class GitHubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubError'
  }
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/
const ISSUE_URL = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/issues\/(\d+)$/
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

/** "owner/repo", "github.com/owner/repo" or a full github.com URL as a repo, or null. */
export function parseRepoInput(text: string): RepoRef | null {
  const trimmed = text.trim().replace(/^https?:\/\//i, '').replace(/^(?:www\.)?github\.com\//i, '')
  const [owner, rawRepo] = trimmed.split('/')
  const repo = rawRepo?.replace(/\.git$/i, '')
  if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null
  return { owner, repo }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const entry of value) {
    const name = typeof entry === 'string' ? entry : isRecord(entry) ? entry.name : undefined
    if (typeof name === 'string' && name.trim()) names.push(clip(name.trim(), LABEL_MAX_LENGTH))
  }
  return names.slice(0, LABELS_MAX)
}

function associationOf(value: unknown): AuthorAssociation {
  return AUTHOR_ASSOCIATIONS.find((known) => known === value) ?? 'NONE'
}

/** One API item as the issue the start function accepts, or null for a pull request or an unreadable item. */
function issueFrom(item: unknown): IssueInput | null {
  if (!isRecord(item) || 'pull_request' in item) return null
  const link = typeof item.html_url === 'string' ? ISSUE_URL.exec(item.html_url) : null
  if (!link || typeof item.title !== 'string' || !item.title.trim()) return null
  if (typeof item.created_at !== 'string' || !CREATED_AT.test(item.created_at)) return null
  const number = Number(link[3])
  if (item.number !== number || !Number.isSafeInteger(number) || number < 1) return null
  return {
    repo: `${link[1]}/${link[2]}`,
    number,
    title: clip(item.title.trim(), TITLE_MAX_LENGTH),
    body: typeof item.body === 'string' ? clip(item.body, BODY_MAX_LENGTH) : '',
    labels: labelNames(item.labels),
    authorAssociation: associationOf(item.author_association),
    createdAt: item.created_at,
    htmlUrl: item.html_url as string,
    comments: typeof item.comments === 'number' && Number.isSafeInteger(item.comments) && item.comments >= 0 ? item.comments : 0,
  }
}

/** The open issues in a /repos/{owner}/{repo}/issues reply: pull requests dropped, bodies capped, newest first. */
export function parseIssues(json: unknown): IssueInput[] {
  if (!Array.isArray(json)) return []
  const issues: IssueInput[] = []
  for (const item of json) {
    const issue = issueFrom(item)
    if (issue) issues.push(issue)
  }
  return issues.slice(0, LIST_SIZE)
}

function clockTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** The plain message for a GitHub 403 or 429. Rate limits read the reset time from the headers. */
export function rateLimitMessage(status: number, headers: Headers, nowMs: number = Date.now()): string {
  const reset = Number(headers.get('x-ratelimit-reset'))
  if (headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset) && reset > 0) {
    const minutes = Math.max(1, Math.ceil((reset * 1000 - nowMs) / 60_000))
    return `GitHub's anonymous limit of 60 requests an hour is used up. It resets at ${clockTime(reset)}, in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
  }
  const wait = Number(headers.get('retry-after'))
  if (Number.isFinite(wait) && wait > 0) return `GitHub asked for a pause. Try again in ${Math.ceil(wait)} seconds.`
  return status === 429 ? 'GitHub is rate limiting this address. Try again in a few minutes.' : 'GitHub refused the request.'
}

/** One request and its whole reply, body included. Rejects with a GitHubError whose message is safe to show. */
async function exchange(url: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json' }, signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new GitHubError('Could not reach GitHub. Check your connection and try again.')
  }
  const repo = /\/repos\/([^/]+\/[^/]+)\/issues/.exec(url)?.[1] ?? 'The repo'
  if (response.status === 404) throw new GitHubError(`${repo} was not found, or it is private.`)
  if (response.status === 403 || response.status === 429) throw new GitHubError(rateLimitMessage(response.status, response.headers))
  if (!response.ok) throw new GitHubError(`GitHub answered with an error (${response.status}). Try again.`)
  const json: unknown = await response.json().catch(() => null)
  if (json === null || typeof json !== 'object') throw new GitHubError('GitHub sent a reply that could not be read.')
  return json
}

/**
 * One GET, bounded by a timer that settles a race with the whole exchange, the body read included, so a reply
 * that stalls is cut at the limit. Rejects with a GitHubError whose message is safe to show. A visitor's own
 * abort rejects with the AbortError.
 */
async function fetchJson(url: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const deadlines = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new GitHubError('GitHub did not answer in time. Try again.'))
    }, REQUEST_MS)
    onAbort = () => {
      controller.abort()
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
  const reply = exchange(url, controller.signal, fetchImpl)
  try {
    return await Promise.race([reply, deadlines])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    reply.catch(() => {})
    deadlines.catch(() => {})
  }
}

/** Lists a repo's latest open issues, newest first. */
export async function listOpenIssues(repo: RepoRef, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<IssueInput[]> {
  const json = await fetchJson(`${API}/repos/${repo.owner}/${repo.repo}/issues?state=open&sort=created&direction=desc&per_page=${PAGE_SIZE}`, signal, fetchImpl)
  if (!Array.isArray(json)) throw new GitHubError('GitHub sent a reply that could not be read.')
  return parseIssues(json)
}

export interface IssueRef {
  owner: string
  repo: string
  number: number
}

const ISSUE_REF = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)(?:\/issues\/|#)(\d{1,9})(?:[/?#].*)?$/i

/** "owner/name#123" or a link to an issue page as one issue, or null. */
export function parseIssueRef(text: string): IssueRef | null {
  const match = ISSUE_REF.exec(text.trim())
  if (!match) return null
  const repo = parseRepoInput(`${match[1]}/${match[2]}`)
  const number = Number(match[3])
  return repo && number >= 1 ? { ...repo, number } : null
}

/** One issue by number, open or closed, so a known duplicate can be triaged. A pull request is refused. */
export async function getIssue(ref: IssueRef, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<IssueInput> {
  const json = await fetchJson(`${API}/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`, signal, fetchImpl)
  const issue = issueFrom(json)
  if (!issue) throw new GitHubError(`${ref.owner}/${ref.repo}#${ref.number} is a pull request, not an issue.`)
  return issue
}

/** The repo's slug for display and for the picker. */
export function slugOf(repo: RepoRef): string {
  return `${repo.owner}/${repo.repo}`
}
