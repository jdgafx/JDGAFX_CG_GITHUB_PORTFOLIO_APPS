import { withDeadline } from '../../netlify/shared/deadline'
import { defaultSelection, type PrFileInput } from '../../netlify/shared/diff'
import { githubFailure, type Parsed } from './github'

/** A public pull request. */
export interface PrRef {
  owner: string
  repo: string
  number: number
}

export type PrState = 'open' | 'closed' | 'merged'

/** The pull request as GitHub lists it: its facts and the files that have a patch to read. */
export interface PullRequest extends PrRef {
  title: string
  state: PrState
  draft: boolean
  /** Files the pull request changes, as GitHub counts them. */
  changedFiles: number
  additions: number
  deletions: number
  url: string
  /** The commits the diff compares, for links to a line: the head for an added line, the base for a removed one. Null when GitHub sent none. */
  headSha: string | null
  baseSha: string | null
  /** The files GitHub listed, up to one page of 100. */
  files: PrFileInput[]
  /** True when GitHub listed fewer files than the pull request changes. */
  partial: boolean
}

const GITHUB_API = 'https://api.github.com'
const FETCH_TIMEOUT_MS = 15_000
const PAGE_SIZE = 100
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

/**
 * Reads a public pull request reference. Accepted forms:
 *   https://github.com/owner/repo/pull/123  (a /files, /commits or #discussion suffix is ignored)
 *   owner/repo#123
 *   owner/repo/pull/123
 */
export function parsePrRef(input: string): Parsed<PrRef> {
  const text = input.trim()
  if (!text) return fail('Enter a pull request link or owner/repo#number.')
  let owner: string | undefined
  let repo: string | undefined
  let number: string | undefined

  const short = /^([^/\s#]+)\/([^/\s#]+)(?:#|\/pull\/)(\d+)\/?$/.exec(text)
  if (short) [, owner, repo, number] = short
  else if (/^(?:https?:\/\/)?(?:www\.)?github\.com[/:]/i.test(text)) {
    let url: URL
    try {
      url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    } catch {
      return fail('That is not a valid link.')
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return fail('Use a plain https://github.com link.')
    const [o, r, kind, n] = url.pathname.split('/').filter(Boolean)
    if (kind === 'issues') return fail('That link is an issue. Open a pull request and copy its link.')
    if (kind !== 'pull' || !n) return fail('Use a pull request link: github.com/owner/repo/pull/123.')
    ;[owner, repo, number] = [o, r, n]
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^[^/\s]+\.[a-z]{2,}\//i.test(text)) {
    return fail('Only public pull requests on github.com can be loaded.')
  } else {
    return fail('Use a pull request link, or owner/repo#number.')
  }

  const id = Number(number)
  if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') {
    return fail('That owner or repository name is not valid on GitHub.')
  }
  if (!Number.isInteger(id) || id < 1 || id > 99_999_999) return fail('That pull request number is not valid.')
  return { ok: true, value: { owner, repo, number: id } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

export function pullUrl({ owner, repo, number }: PrRef): string {
  return `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`
}

export const filesUrl = (ref: PrRef): string => `${pullUrl(ref)}/files?per_page=${PAGE_SIZE}`

/** Checks the pull request reply. Only the fields the page shows are read. */
export function readPull(data: unknown, ref: PrRef): Parsed<Omit<PullRequest, 'files' | 'partial'>> {
  if (!isRecord(data)) return fail('GitHub sent a reply this page could not read.')
  const { title, state, merged, draft, changed_files: changedFiles, additions, deletions, html_url: url, head, base } = data
  if (typeof title !== 'string' || typeof url !== 'string' || !isCount(changedFiles) || !isCount(additions) || !isCount(deletions)) {
    return fail('GitHub sent a reply this page could not read.')
  }
  if (!url.startsWith('https://github.com/')) return fail('GitHub sent a reply this page could not read.')
  const prState: PrState = merged === true ? 'merged' : state === 'closed' ? 'closed' : 'open'
  const sha = (side: unknown) => (isRecord(side) && typeof side.sha === 'string' && /^[0-9a-f]{7,64}$/i.test(side.sha) ? side.sha : null)
  return { ok: true, value: { ...ref, title, state: prState, draft: draft === true, changedFiles, additions, deletions, url, headSha: sha(head), baseSha: sha(base) } }
}

/** Checks the files reply. A file without a patch is kept, so the page can say why it is not reviewed. */
export function readFiles(data: unknown): Parsed<PrFileInput[]> {
  if (!Array.isArray(data)) return fail('GitHub sent a reply this page could not read.')
  const files: PrFileInput[] = []
  for (const item of data) {
    if (!isRecord(item) || typeof item.filename !== 'string' || typeof item.status !== 'string') {
      return fail('GitHub sent a reply this page could not read.')
    }
    files.push({ path: item.filename, status: item.status, patch: typeof item.patch === 'string' ? item.patch : null })
  }
  return { ok: true, value: files }
}

async function getJson(url: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<Parsed<unknown>> {
  const response = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json' }, signal })
  if (!response.ok) return fail(githubFailure(response.status, response.headers, Date.now(), 'pull request'))
  return { ok: true, value: await response.json().catch(() => null) }
}

/**
 * Fetches a public pull request and its changed files straight from the browser: two requests, one deadline for both
 * that covers the body reads. Never rejects except for the visitor's own abort; every failure is a message to show.
 */
export async function fetchPullRequest(
  ref: PrRef,
  signal?: AbortSignal,
  { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Parsed<PullRequest>> {
  try {
    return await withDeadline(timeoutMs, signal, async (inner) => {
      // The pull request first, then its files: a missing or private pull request costs one GitHub call, not two.
      const pull = await getJson(pullUrl(ref), inner, fetchImpl)
      if (!pull.ok) return pull
      const list = await getJson(filesUrl(ref), inner, fetchImpl)
      if (!list.ok) return list
      const head = readPull(pull.value, ref)
      if (!head.ok) return head
      const files = readFiles(list.value)
      if (!files.ok) return files
      if (files.value.length === 0) return fail('That pull request lists no changed files.')
      return { ok: true, value: { ...head.value, files: files.value, partial: files.value.length < head.value.changedFiles } } as const
    })
  } catch (err) {
    if (signal?.aborted) throw err
    if ((err as { name?: unknown } | null)?.name === 'TimeoutError') return fail('GitHub did not answer in time. Try again.')
    return fail('Could not reach GitHub. Check your connection and try again.')
  }
}

/**
 * Where a comment's line is on GitHub: the file at the pull request's head for an added or context line, at its base for a
 * removed line, with the line anchor. A header position links to the file alone. Null when the commit is not known.
 */
export function lineHref(pr: Pick<PullRequest, 'owner' | 'repo' | 'headSha' | 'baseSha'>, where: { file: string; line: number; side: 'new' | 'old' }): string | null {
  const sha = where.side === 'old' ? pr.baseSha : pr.headSha
  if (!sha) return null
  const path = where.file.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/blob/${sha}/${path}${where.line > 0 ? `#L${where.line}` : ''}`
}

/** The files a review includes before the visitor changes anything. */
export const initialSelection = (pr: Pick<PullRequest, 'files'>): Set<string> => defaultSelection(pr.files)
