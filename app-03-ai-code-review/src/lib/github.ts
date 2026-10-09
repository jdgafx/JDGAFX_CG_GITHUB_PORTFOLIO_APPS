import { LANGUAGES } from '../constants'
import { MAX_CODE_LENGTH } from './limits'

/** Where a public GitHub file lives. `ref` is a branch, tag or commit, and absent means the default branch. */
export interface GitHubRef {
  owner: string
  repo: string
  ref: string | null
  path: string
}

/** A file read from GitHub and ready for the editor. `text` is exactly what the review will number. */
export interface GitHubFile extends GitHubRef {
  text: string
  /** Size in bytes, as GitHub reports it. */
  size: number
  /** The file's page on github.com. */
  url: string
  /** Git blob SHA, so a default-branch load still names the exact content. */
  sha: string
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const GITHUB_API = 'https://api.github.com'
const FETCH_TIMEOUT_MS = 15_000
/** UTF-8 uses at most four bytes per character, so a file larger than this cannot fit the limit. */
const MAX_BYTES = MAX_CODE_LENGTH * 4

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])
const RAW_HOST = 'raw.githubusercontent.com'

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

const EXTENSION_LANGUAGE: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', pyi: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hh: 'cpp', hpp: 'cpp', hxx: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  sh: 'shell', bash: 'shell',
  css: 'css',
  html: 'html', htm: 'html',
  sql: 'sql',
}

/** The review language for a file path, or null when the extension is unknown or the language is not offered. */
export function languageForPath(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const language = EXTENSION_LANGUAGE[name.slice(dot + 1).toLowerCase()]
  return LANGUAGES.some((l) => l.value === language) ? language : null
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/** Splits `ref/path...` after blob, raw or the raw host. A `refs/heads/` or `refs/tags/` prefix is dropped. */
function refAndPath(segments: string[]): Parsed<{ ref: string; path: string[] }> {
  const rest = segments[0] === 'refs' && (segments[1] === 'heads' || segments[1] === 'tags') ? segments.slice(2) : segments
  const [ref, ...path] = rest
  if (!ref || path.length === 0) return fail('The link needs a file path after the branch or tag name.')
  return { ok: true, value: { ref, path } }
}

function build(owner: string, repo: string, ref: string | null, rawPath: string[]): Parsed<GitHubRef> {
  const repoName = repo.replace(/\.git$/, '')
  if (!OWNER.test(owner) || !REPO.test(repoName) || repoName === '.' || repoName === '..') {
    return fail('That owner or repository name is not valid on GitHub.')
  }
  const decodedRef = ref === null ? null : decodeSegment(ref)
  if (decodedRef === '' || (ref !== null && decodedRef === null)) return fail('That branch or tag name is not valid.')
  const path: string[] = []
  for (const raw of rawPath) {
    const segment = decodeSegment(raw)
    if (segment === null || segment === '' || segment === '.' || segment === '..' || /[\\\0]/.test(segment)) {
      return fail('That file path is not valid.')
    }
    path.push(segment)
  }
  if (path.length === 0) return fail('Add the path of a file, such as owner/repo/src/main.py.')
  return { ok: true, value: { owner, repo: repoName, ref: decodedRef, path: path.join('/') } }
}

/**
 * Reads a public GitHub file reference. Accepted forms:
 *   https://github.com/owner/repo/blob/ref/path/to/file.ext  (also /raw/, #L10 and ?plain=1 are ignored)
 *   https://raw.githubusercontent.com/owner/repo/ref/path/to/file.ext
 *   owner/repo/path/to/file.ext                               (the default branch)
 * The first segment after blob is the ref, so a branch name containing "/" cannot be told apart from a
 * folder: link to a tag or a commit instead. Any other host is rejected.
 */
export function parseGitHubRef(input: string): Parsed<GitHubRef> {
  const text = input.trim()
  if (!text) return fail('Enter a GitHub file link or owner/repo/path.')

  const hasHost = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com|raw\.githubusercontent\.com)(?:[/:?#]|$)/i.test(text)
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^[^/\s]+\.[a-z]{2,}(?::\d+)?\//i.test(text)
  if (!hasHost && !looksLikeUrl) {
    const [owner = '', repo = '', ...path] = text.split(/[?#]/)[0].split('/')
    return build(owner, repo, null, path)
  }

  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return fail('That is not a valid link.')
  }
  const host = url.hostname.toLowerCase()
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.port || url.username || url.password) {
    return fail('Use a plain https://github.com link.')
  }
  const segments = url.pathname.split('/').filter(Boolean)

  if (host === RAW_HOST) {
    const [owner = '', repo = '', ...rest] = segments
    const split = refAndPath(rest)
    return split.ok ? build(owner, repo, split.value.ref, split.value.path) : split
  }
  if (!GITHUB_HOSTS.has(host)) return fail('Only public files on github.com can be loaded.')

  const [owner = '', repo = '', kind, ...rest] = segments
  if (!repo) return fail('Add the repository and the path of a file.')
  if (kind === 'tree') return fail('That link is a folder. Open a file and copy its link.')
  if (kind !== 'blob' && kind !== 'raw') return fail('Use a link to a file: github.com/owner/repo/blob/ref/path.')
  const split = refAndPath(rest)
  return split.ok ? build(owner, repo, split.value.ref, split.value.path) : split
}

/** The contents API URL for a file. Every segment is encoded and an absent ref sends no query at all. */
export function contentsUrl({ owner, repo, ref, path }: GitHubRef): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  return `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encoded}${query}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`
}

const count = (n: number) => n.toLocaleString('en-US')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Base64 (with the line breaks GitHub adds) to UTF-8 text. Null for bytes that are not valid text. */
function decodeBase64Text(content: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(content.replace(/\s/g, '')), (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Makes the file text match what GitHub shows line for line: no BOM, LF line breaks, and the final line break
 * dropped so a file of N lines is N lines here and not N + 1. No other character changes.
 */
export function normaliseSourceText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n$/, '')
}

/** Checks a contents API reply for a file and turns it into editor text, or says why it cannot be reviewed. */
export function readContentsReply(data: unknown, ref: GitHubRef): Parsed<GitHubFile> {
  if (Array.isArray(data)) return fail('That path is a folder. Pick a file.')
  if (!isRecord(data)) return fail('GitHub sent a reply this page could not read.')
  if (data.type !== 'file') return fail(`That path is a ${String(data.type)}, not a file that can be reviewed.`)
  const { size, content, encoding, html_url: url, sha } = data
  if (typeof size !== 'number' || typeof url !== 'string' || typeof sha !== 'string') {
    return fail('GitHub sent a reply this page could not read.')
  }
  if (size === 0) return fail('That file is empty.')
  if (size > MAX_BYTES) {
    return fail(`That file is ${formatBytes(size)}. CodeLens reviews up to ${count(MAX_CODE_LENGTH)} characters, so pick a smaller file.`)
  }
  if (encoding !== 'base64' || typeof content !== 'string') return fail('GitHub did not send the text of that file.')
  const decoded = decodeBase64Text(content)
  if (decoded === null || decoded.includes('\0')) return fail('That file is binary or not UTF-8 text, so it cannot be reviewed.')
  const text = normaliseSourceText(decoded)
  if (text.length > MAX_CODE_LENGTH) {
    return fail(
      `That file has ${count(text.length)} characters. CodeLens reviews up to ${count(MAX_CODE_LENGTH)}, so pick a smaller file.`,
    )
  }
  if (!text.trim()) return fail('That file has no code in it.')
  if (!url.startsWith('https://github.com/')) return fail('GitHub sent a reply this page could not read.')
  return { ok: true, value: { ...ref, text, size, url, sha } }
}

/** The visitor-facing message for a non-OK reply. A spent anonymous quota says when it resets. */
export function githubFailure(status: number, headers: Pick<Headers, 'get'>, now = Date.now()): string {
  if (status === 429 || (status === 403 && headers.get('x-ratelimit-remaining') === '0')) {
    const reset = Number(headers.get('x-ratelimit-reset'))
    const minutes = Number.isFinite(reset) && reset > 0 ? Math.max(1, Math.ceil((reset * 1000 - now) / 60_000)) : null
    return `GitHub allows 60 anonymous requests an hour from one address, and this one has used them. ${
      minutes === null ? 'Try again later.' : `Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
    }`
  }
  if (status === 404) return 'GitHub has no such public file. Check the owner, repository, branch or tag, and path.'
  if (status === 403) return 'GitHub refused to serve that file.'
  if (status >= 500) return 'GitHub is having trouble right now. Try again in a moment.'
  return `GitHub answered with an unexpected status (${status}).`
}

/** Fetches one public file straight from the browser. Never rejects: every failure is a message for the visitor. */
export async function fetchGitHubFile(
  ref: GitHubRef,
  signal?: AbortSignal,
  { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Parsed<GitHubFile>> {
  const timeout = AbortSignal.timeout(timeoutMs)
  try {
    const response = await fetchImpl(contentsUrl(ref), {
      headers: { Accept: 'application/vnd.github+json' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!response.ok) return fail(githubFailure(response.status, response.headers))
    return readContentsReply(await response.json().catch(() => null), ref)
  } catch (err) {
    if (signal?.aborted) throw err
    if (timeout.aborted) return fail('GitHub did not answer in time. Try again.')
    return fail('Could not reach GitHub. Check your connection and try again.')
  }
}
