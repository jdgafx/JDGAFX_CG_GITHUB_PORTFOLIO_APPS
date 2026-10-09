import { describe, expect, it, vi } from 'vitest'
import { fetchPullRequest, filesUrl, initialSelection, lineHref, parsePrRef, pullUrl, readFiles, readPull } from '../../src/lib/pullrequest'

const REF = { owner: 'gorilla', repo: 'mux', number: 731 }

// Fields of GitHub's real replies for gorilla/mux pull request 731 (https://github.com/gorilla/mux/pull/731).
const PULL = { title: 'Add RegexpCompileFunc to override regexp.Compile', state: 'closed', merged: true, draft: false, changed_files: 3, additions: 73, deletions: 3, html_url: 'https://github.com/gorilla/mux/pull/731', head: { sha: '6b3a1ad1f0a1e7bc3f2c8d9e4a5b6c7d8e9f0a1b' }, base: { sha: '0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d' } }
const FILES = [
  { filename: 'mux.go', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' },
  { filename: 'regexp.go', status: 'modified', patch: '@@ -1 +1 @@\n-c\n+d' },
  { filename: 'route_test.go', status: 'added', patch: '@@ -0,0 +1 @@\n+e' },
]

describe('parsePrRef', () => {
  it.each([
    ['https://github.com/gorilla/mux/pull/731'],
    ['github.com/gorilla/mux/pull/731/files'],
    ['https://github.com/gorilla/mux/pull/731#discussion_r1'],
    ['gorilla/mux#731'],
    ['gorilla/mux/pull/731'],
  ])('reads %s', (input) => {
    expect(parsePrRef(input)).toEqual({ ok: true, value: REF })
  })

  it.each([
    ['', /Enter a pull request/],
    ['https://github.com/gorilla/mux/issues/5', /issue/],
    ['https://github.com/gorilla/mux/blob/main/mux.go', /pull request link/],
    ['https://gitlab.com/a/b/pull/1', /Only public pull requests on github.com/],
    ['mux', /owner\/repo#number/],
    ['gorilla/mux#0', /not valid|Use a pull request/],
    ['-bad-/mux#5', /owner or repository/],
  ])('rejects %j with a plain message', (input, message) => {
    const parsed = parsePrRef(input)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toMatch(message)
  })
})

describe('urls', () => {
  it('builds the two api.github.com urls, the second asking for a full page', () => {
    expect(pullUrl(REF)).toBe('https://api.github.com/repos/gorilla/mux/pulls/731')
    expect(filesUrl(REF)).toBe('https://api.github.com/repos/gorilla/mux/pulls/731/files?per_page=100')
  })
})

describe('lineHref', () => {
  const pr = { owner: 'gorilla', repo: 'mux', headSha: '6b3a1ad1f0a1e7bc3f2c8d9e4a5b6c7d8e9f0a1b', baseSha: '0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d' }

  it('links an added line to the file at the head commit, and a removed line to the base commit', () => {
    expect(lineHref(pr, { file: 'mux.go', line: 25, side: 'new' })).toBe('https://github.com/gorilla/mux/blob/6b3a1ad1f0a1e7bc3f2c8d9e4a5b6c7d8e9f0a1b/mux.go#L25')
    expect(lineHref(pr, { file: 'src/a b.go', line: 7, side: 'old' })).toBe('https://github.com/gorilla/mux/blob/0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d/src/a%20b.go#L7')
  })

  it('links a header position to the file alone, and gives nothing when the commit is unknown', () => {
    expect(lineHref(pr, { file: 'mux.go', line: 0, side: 'new' })).toMatch(/\/mux\.go$/)
    expect(lineHref({ ...pr, headSha: null }, { file: 'mux.go', line: 3, side: 'new' })).toBeNull()
  })
})

describe('readPull and readFiles', () => {
  it('reads the facts the page shows, and a merged pull request is merged, not closed', () => {
    const read = readPull(PULL, REF)
    expect(read).toMatchObject({ ok: true, value: { title: PULL.title, state: 'merged', changedFiles: 3, additions: 73, deletions: 3, headSha: '6b3a1ad1f0a1e7bc3f2c8d9e4a5b6c7d8e9f0a1b' } })
  })

  it('refuses a reply whose url is not on github.com', () => {
    expect(readPull({ ...PULL, html_url: 'https://evil.example/x' }, REF).ok).toBe(false)
  })

  it('keeps a file with no patch so the page can say why it is not reviewed', () => {
    const read = readFiles([...FILES, { filename: 'logo.png', status: 'added' }])
    expect(read.ok && read.value.at(-1)).toEqual({ path: 'logo.png', status: 'added', patch: null })
  })

  it('refuses a files reply that is not a list', () => {
    expect(readFiles({ message: 'Not Found' }).ok).toBe(false)
  })
})

function reply(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

describe('fetchPullRequest', () => {
  it('fetches the pull request and its files, and reports a full listing as complete', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => (String(url).includes('/files') ? reply(FILES) : reply(PULL)))
    const result = await fetchPullRequest(REF, undefined, { fetchImpl: fetchImpl as typeof fetch })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ ok: true, value: { title: PULL.title, partial: false, files: [{ path: 'mux.go' }, { path: 'regexp.go' }, { path: 'route_test.go' }] } })
  })

  it('says so when GitHub lists fewer files than the pull request changes', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => (String(url).includes('/files') ? reply(FILES) : reply({ ...PULL, changed_files: 340 })))
    const result = await fetchPullRequest(REF, undefined, { fetchImpl: fetchImpl as typeof fetch })
    expect(result.ok && result.value.partial).toBe(true)
  })

  it('turns a 404 into a message, and a spent quota into the reset time', async () => {
    const notFound = vi.fn(async () => reply({}, { status: 404 }))
    const missing = await fetchPullRequest(REF, undefined, { fetchImpl: notFound as unknown as typeof fetch })
    expect(missing).toEqual({ ok: false, error: 'GitHub has no such public pull request, or the repository is private. Check the owner, repository and number.' })
    // A missing pull request costs one GitHub call, not two.
    expect(notFound).toHaveBeenCalledTimes(1)
    const limited = await fetchPullRequest(REF, undefined, {
      fetchImpl: (async () => reply({}, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) } })) as typeof fetch,
    })
    expect(limited.ok).toBe(false)
    if (!limited.ok) expect(limited.error).toMatch(/60 anonymous requests an hour/)
  })

  it('stops at the deadline even when the body never arrives', async () => {
    const hang = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as typeof fetch
    const result = await fetchPullRequest(REF, undefined, { fetchImpl: hang, timeoutMs: 30 })
    expect(result).toEqual({ ok: false, error: 'GitHub did not answer in time. Try again.' })
  })

  it('rethrows the visitor\'s own abort', async () => {
    const controller = new AbortController()
    const hang = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as typeof fetch
    const pending = fetchPullRequest(REF, controller.signal, { fetchImpl: hang })
    controller.abort()
    await expect(pending).rejects.toBeDefined()
  })
})

describe('initialSelection', () => {
  it('selects the reviewable files that fit, in order', () => {
    expect([...initialSelection({ files: [...FILES.map((f) => ({ path: f.filename, status: f.status, patch: f.patch })), { path: 'logo.png', status: 'added', patch: null }] })]).toEqual(['mux.go', 'regexp.go', 'route_test.go'])
  })
})
