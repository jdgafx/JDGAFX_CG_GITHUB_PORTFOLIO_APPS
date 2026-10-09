import { describe, expect, it, vi } from 'vitest'
import { GitHubError, LIST_SIZE, listOpenIssues, parseIssues, parseRepoInput, rateLimitMessage } from '../../src/lib/github'
import { BODY_MAX_LENGTH } from '../../src/lib/limits'
import { issueFrom } from '../../netlify/shared/issue-input'
import { apiItem } from '../helpers/issues'

/** The recorded shape of GET /repos/{owner}/{repo}/issues: issues, a pull request, a null body. */
const FIXTURE = [
  apiItem({ number: 9, title: 'Newest issue', body: null, labels: [] }),
  apiItem({ number: 8, title: 'A pull request', pull_request: { url: 'https://api.github.com/repos/acme/widgets/pulls/8' } }),
  apiItem({ number: 7, title: '  Crash on startup  ', body: 'It crashes.\nOn Linux.', author_association: 'FIRST_TIME_CONTRIBUTOR' }),
]

describe('parseIssues', () => {
  it('drops pull requests, keeps the order, and maps each field', () => {
    const issues = parseIssues(FIXTURE)
    expect(issues.map((entry) => entry.number)).toEqual([9, 7])
    expect(issues[1]).toEqual({
      repo: 'acme/widgets',
      number: 7,
      title: 'Crash on startup',
      body: 'It crashes.\nOn Linux.',
      labels: ['bug', 'help wanted'],
      authorAssociation: 'FIRST_TIME_CONTRIBUTOR',
      createdAt: '2026-10-07T08:30:00Z',
      htmlUrl: 'https://github.com/acme/widgets/issues/7',
      comments: 3,
    })
  })

  it('turns a null body into an empty string and a missing label list into none', () => {
    const [first] = parseIssues([apiItem({ body: null, labels: undefined })])
    expect(first).toMatchObject({ body: '', labels: [] })
  })

  it('caps the body at 6,000 characters without splitting an emoji', () => {
    const [first] = parseIssues([apiItem({ body: '\u{1F600}'.repeat(BODY_MAX_LENGTH + 5) })])
    expect(Array.from(first.body)).toHaveLength(BODY_MAX_LENGTH)
    expect(first.body.endsWith('\u{1F600}')).toBe(true)
  })

  it('reads labels given as names or as strings, and drops blanks', () => {
    const [first] = parseIssues([apiItem({ labels: [{ name: 'bug' }, 'docs', { name: '  ' }, { color: 'fff' }, 7] })])
    expect(first.labels).toEqual(['bug', 'docs'])
  })

  it('maps an association GitHub may add later to NONE instead of failing the issue', () => {
    expect(parseIssues([apiItem({ author_association: 'SOMETHING_NEW' })])[0].authorAssociation).toBe('NONE')
  })

  it('skips items it cannot read and never throws on odd input', () => {
    const odd = [
      null,
      'text',
      42,
      apiItem({ html_url: 'https://example.com/acme/widgets/issues/1', number: 1 }),
      apiItem({ number: 2, title: '   ' }),
      apiItem({ number: 3, created_at: 'yesterday' }),
      apiItem({ number: 4, html_url: 'https://github.com/acme/widgets/issues/5' }),
      apiItem({ number: 6, comments: 'many' }),
    ]
    expect(parseIssues(odd).map((entry) => [entry.number, entry.comments])).toEqual([[6, 0]])
    expect(parseIssues({ message: 'Not Found' })).toEqual([])
    expect(parseIssues(undefined)).toEqual([])
  })

  it('lists at most 25 issues', () => {
    const many = Array.from({ length: 60 }, (_, index) => apiItem({ number: index + 1 }))
    expect(LIST_SIZE).toBe(25)
    expect(parseIssues(many)).toHaveLength(25)
  })

  it('produces issues the start function accepts', () => {
    for (const parsed of parseIssues(FIXTURE)) expect(issueFrom({ issue: parsed }).ok).toBe(true)
  })

  it('takes the repo from the issue link, so a repository that moved or changed case still matches', () => {
    const [first] = parseIssues([apiItem({ number: 5, html_url: 'https://github.com/react/react/issues/5' })])
    expect(first.repo).toBe('react/react')
    expect(issueFrom({ issue: first }).ok).toBe(true)
  })
})

describe('parseRepoInput', () => {
  it.each([
    ['react/react', 'react', 'react'],
    ['  vitejs/vite ', 'vitejs', 'vite'],
    ['https://github.com/microsoft/vscode', 'microsoft', 'vscode'],
    ['github.com/denoland/deno/issues/5', 'denoland', 'deno'],
    ['https://github.com/langchain-ai/langgraphjs.git', 'langchain-ai', 'langgraphjs'],
    ['owner/my.repo_name-2', 'owner', 'my.repo_name-2'],
  ])('reads %j', (text, owner, repo) => {
    expect(parseRepoInput(text)).toEqual({ owner, repo })
  })

  it.each(['', 'react', 'a/', '/b', 'a b/c', '-a/b', 'a/..', 'a/.', 'a/b c', 'a/<script>', `${'x'.repeat(40)}/repo`, 'https://example.com'])(
    'refuses %j',
    (text) => {
      expect(parseRepoInput(text)).toBeNull()
    },
  )
})

describe('rateLimitMessage', () => {
  const NOW = Date.UTC(2026, 9, 9, 12, 0, 0)
  const headers = (values: Record<string, string>) => new Headers(values)

  it('names the reset time and the minutes left when the anonymous limit is used up', () => {
    const reset = String((NOW + 17 * 60_000 + 20_000) / 1000)
    const message = rateLimitMessage(403, headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }), NOW)
    expect(message).toContain("GitHub's anonymous limit of 60 requests an hour is used up.")
    expect(message).toContain('in about 18 minutes.')
    expect(message).toMatch(/resets at \d{1,2}:\d{2}\s?(?:AM|PM)/)
  })

  it('says one minute, not one minutes', () => {
    const message = rateLimitMessage(429, headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((NOW + 5_000) / 1000) }), NOW)
    expect(message).toContain('in about 1 minute.')
  })

  it('uses Retry-After for a secondary limit', () => {
    expect(rateLimitMessage(429, headers({ 'retry-after': '45' }), NOW)).toBe('GitHub asked for a pause. Try again in 45 seconds.')
  })

  it('falls back to a plain sentence by status', () => {
    expect(rateLimitMessage(429, headers({}), NOW)).toBe('GitHub is rate limiting this address. Try again in a few minutes.')
    expect(rateLimitMessage(403, headers({ 'x-ratelimit-remaining': '12' }), NOW)).toBe('GitHub refused the request.')
  })
})

describe('listOpenIssues', () => {
  const repo = { owner: 'acme', repo: 'widgets' }
  const reply = (body: unknown, init: ResponseInit = {}) => vi.fn(async () => Response.json(body, init)) as unknown as typeof fetch

  it('asks for the newest open issues of the repo and returns the parsed list', async () => {
    const fetchStub = reply(FIXTURE)
    const issues = await listOpenIssues(repo, undefined, fetchStub)
    expect(issues.map((entry) => entry.number)).toEqual([9, 7])
    const [url, init] = vi.mocked(fetchStub).mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/acme/widgets/issues?state=open&sort=created&direction=desc&per_page=100')
    expect((init?.headers as Record<string, string>).Accept).toBe('application/vnd.github+json')
  })

  it('returns an empty list for a repo with no open issues', async () => {
    await expect(listOpenIssues(repo, undefined, reply([]))).resolves.toEqual([])
  })

  it('reports the rate limit with its reset time on a 403', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 600)
    const fetchStub = reply({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } })
    const failure = await listOpenIssues(repo, undefined, fetchStub).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(GitHubError)
    expect((failure as GitHubError).message).toContain('is used up. It resets at')
  })

  it('reports a missing or private repo on a 404', async () => {
    const failure = await listOpenIssues(repo, undefined, reply({ message: 'Not Found' }, { status: 404 })).catch((err: unknown) => err)
    expect((failure as GitHubError).message).toBe('acme/widgets was not found, or it is private.')
  })

  it('reports a server error, an unreadable reply and a lost connection in plain words', async () => {
    const server = await listOpenIssues(repo, undefined, reply({}, { status: 502 })).catch((err: unknown) => err)
    expect((server as GitHubError).message).toBe('GitHub answered with an error (502). Try again.')
    const odd = await listOpenIssues(repo, undefined, reply({ not: 'a list' })).catch((err: unknown) => err)
    expect((odd as GitHubError).message).toBe('GitHub sent a reply that could not be read.')
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const lost = await listOpenIssues(repo, undefined, offline).catch((err: unknown) => err)
    expect((lost as GitHubError).message).toBe('Could not reach GitHub. Check your connection and try again.')
  })

  it('cuts a reply whose body never finishes at 10 seconds, even when the fetch ignores its abort signal', async () => {
    vi.useFakeTimers()
    const stuck = vi.fn(async () => new Response(new ReadableStream({ start() {} }), { status: 200 })) as unknown as typeof fetch
    const assertion = expect(listOpenIssues(repo, undefined, stuck)).rejects.toMatchObject({
      name: 'GitHubError',
      message: 'GitHub did not answer in time. Try again.',
    })
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    vi.useRealTimers()
  })

  it('passes the visitor abort through instead of showing it as an error', async () => {
    const controller = new AbortController()
    const waiting = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    ) as unknown as typeof fetch
    const pending = listOpenIssues(repo, controller.signal, waiting).catch((err: unknown) => err)
    controller.abort()
    const failure = await pending
    expect(failure).not.toBeInstanceOf(GitHubError)
    expect((failure as Error).name).toBe('AbortError')
  })
})
