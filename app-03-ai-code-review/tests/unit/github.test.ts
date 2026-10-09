import { describe, expect, it, vi } from 'vitest'
import { GITHUB_SUGGESTIONS, LANGUAGES } from '../../src/constants'
import {
  contentsUrl,
  fetchGitHubFile,
  formatBytes,
  githubFailure,
  languageForPath,
  normaliseSourceText,
  parseGitHubRef,
  readContentsReply,
} from '../../src/lib/github'
import type { GitHubRef } from '../../src/lib/github'
import { MAX_CODE_LENGTH } from '../../src/lib/limits'

const REF: GitHubRef = { owner: 'psf', repo: 'requests', ref: 'v2.32.3', path: 'src/requests/auth.py' }

/** The shape of a real contents API reply for a file: base64 wrapped at 60 columns, as GitHub does. */
function fileReply(text: string | Uint8Array, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const bytes = typeof text === 'string' ? Buffer.from(text, 'utf8') : Buffer.from(text)
  return {
    type: 'file',
    encoding: 'base64',
    size: bytes.length,
    name: 'auth.py',
    path: REF.path,
    sha: '0123456789abcdef0123456789abcdef01234567',
    html_url: 'https://github.com/psf/requests/blob/v2.32.3/src/requests/auth.py',
    content: (bytes.toString('base64').match(/.{1,60}/g) ?? []).join('\n') + '\n',
    ...overrides,
  }
}

function loaded(reply: Record<string, unknown>) {
  const result = readContentsReply(reply, REF)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

describe('parseGitHubRef', () => {
  it.each([
    ['https://github.com/psf/requests/blob/v2.32.3/src/requests/auth.py', { owner: 'psf', repo: 'requests', ref: 'v2.32.3', path: 'src/requests/auth.py' }],
    ['https://www.github.com/gorilla/mux/blob/main/mux.go', { owner: 'gorilla', repo: 'mux', ref: 'main', path: 'mux.go' }],
    ['http://github.com/gorilla/mux/blob/main/mux.go', { owner: 'gorilla', repo: 'mux', ref: 'main', path: 'mux.go' }],
    ['github.com/gorilla/mux/blob/main/mux.go', { owner: 'gorilla', repo: 'mux', ref: 'main', path: 'mux.go' }],
    ['  https://github.com/gorilla/mux/blob/main/mux.go#L10-L20  ', { owner: 'gorilla', repo: 'mux', ref: 'main', path: 'mux.go' }],
    ['https://github.com/gorilla/mux/blob/main/mux.go?plain=1', { owner: 'gorilla', repo: 'mux', ref: 'main', path: 'mux.go' }],
    ['https://github.com/o/r/raw/refs/heads/dev/lib/a.js', { owner: 'o', repo: 'r', ref: 'dev', path: 'lib/a.js' }],
    ['https://github.com/o/r/blob/0a1b2c3d4e5f/docs/My%20File.md', { owner: 'o', repo: 'r', ref: '0a1b2c3d4e5f', path: 'docs/My File.md' }],
    ['https://raw.githubusercontent.com/psf/requests/v2.32.3/src/requests/auth.py', REF],
    ['https://raw.githubusercontent.com/o/r/refs/tags/v1/a/b.ts', { owner: 'o', repo: 'r', ref: 'v1', path: 'a/b.ts' }],
    ['https://github.com/o/r.git/blob/main/a.c', { owner: 'o', repo: 'r', ref: 'main', path: 'a.c' }],
    ['psf/requests/src/requests/auth.py', { owner: 'psf', repo: 'requests', ref: null, path: 'src/requests/auth.py' }],
    ['golang/go/src/sync/once.go', { owner: 'golang', repo: 'go', ref: null, path: 'src/sync/once.go' }],
  ])('reads %s', (input, expected) => {
    expect(parseGitHubRef(input)).toEqual({ ok: true, value: expected })
  })

  it.each([
    ['https://gitlab.com/o/r/blob/main/a.py', 'Only public files on github.com can be loaded.'],
    ['https://github.com.evil.example/o/r/blob/main/a.py', 'Only public files on github.com can be loaded.'],
    ['https://evil.example/github.com/o/r/blob/main/a.py', 'Only public files on github.com can be loaded.'],
    ['https://gist.github.com/o/abc123', 'Only public files on github.com can be loaded.'],
    ['https://github.com@evil.example/o/r/blob/main/a.py', 'Use a plain https://github.com link.'],
    ['https://github.com:8443/o/r/blob/main/a.py', 'Use a plain https://github.com link.'],
    ['ftp://github.com/o/r/blob/main/a.py', 'Use a plain https://github.com link.'],
    ['https://github.com/o/r/tree/main/src', 'That link is a folder. Open a file and copy its link.'],
    ['https://github.com/o/r', 'Use a link to a file: github.com/owner/repo/blob/ref/path.'],
    ['https://github.com/o', 'Add the repository and the path of a file.'],
    ['https://github.com/o/r/blob/main', 'The link needs a file path after the branch or tag name.'],
    ['https://github.com/o/r/blob/main/a/%ZZ', 'That file path is not valid.'],
    ['owner/repo', 'Add the path of a file, such as owner/repo/src/main.py.'],
    ['owner/repo/a/../b', 'That file path is not valid.'],
    ['-bad/repo/a.py', 'That owner or repository name is not valid on GitHub.'],
    ['', 'Enter a GitHub file link or owner/repo/path.'],
    ['   ', 'Enter a GitHub file link or owner/repo/path.'],
  ])('rejects %j', (input, error) => {
    expect(parseGitHubRef(input)).toEqual({ ok: false, error })
  })

  it('resolves dot segments before parsing, so the API path never holds one', () => {
    expect(parseGitHubRef('https://github.com/o/r/blob/main/a/%2E%2E/b')).toEqual({
      ok: true,
      value: { owner: 'o', repo: 'r', ref: 'main', path: 'b' },
    })
  })

  it('parses every suggested link', () => {
    expect(GITHUB_SUGGESTIONS.map(({ link }) => parseGitHubRef(link).ok)).toEqual([true, true, true])
  })
})

describe('languageForPath', () => {
  it.each([
    ['src/requests/auth.py', 'python'],
    ['mux.go', 'go'],
    ['src/createStore.ts', 'typescript'],
    ['App.TSX', 'typescript'],
    ['lib/index.mjs', 'javascript'],
    ['include/a.hpp', 'cpp'],
    ['main.c', 'c'],
    ['Program.cs', 'csharp'],
    ['run.sh', 'shell'],
    ['index.htm', 'html'],
  ])('maps %s to %s', (path, language) => {
    expect(languageForPath(path)).toBe(language)
  })

  it.each(['Makefile', '.bashrc', 'notes.txt', 'archive.tar.gz', 'dir.py/README', 'noext.'])(
    'gives null for %s',
    (path) => {
      expect(languageForPath(path)).toBeNull()
    },
  )

  it('only returns languages the editor offers', () => {
    const offered = new Set(LANGUAGES.map((l) => l.value))
    for (const path of ['a.py', 'a.go', 'a.ts', 'a.rs', 'a.java', 'a.kt', 'a.swift', 'a.php', 'a.rb', 'a.sql', 'a.css']) {
      expect(offered.has(languageForPath(path) ?? '')).toBe(true)
    }
  })
})

describe('contentsUrl', () => {
  it('encodes each segment and sends the ref when there is one', () => {
    expect(contentsUrl({ owner: 'o', repo: 'r', ref: 'v1.0', path: 'docs/My File#1.md' })).toBe(
      'https://api.github.com/repos/o/r/contents/docs/My%20File%231.md?ref=v1.0',
    )
  })

  it('sends no query at all for the default branch', () => {
    expect(contentsUrl({ ...REF, ref: null })).toBe('https://api.github.com/repos/psf/requests/contents/src/requests/auth.py')
  })
})

describe('normaliseSourceText', () => {
  it('keeps line numbers equal to GitHub: LF breaks, no BOM, no phantom last line', () => {
    const text = normaliseSourceText('﻿one\r\ntwo\r\nthree\r\n')
    expect(text).toBe('one\ntwo\nthree')
    expect(text.split('\n')).toEqual(['one', 'two', 'three'])
  })

  it('removes only one final line break and touches nothing else', () => {
    expect(normaliseSourceText('a\n\n')).toBe('a\n')
    expect(normaliseSourceText('  indented\t\n')).toBe('  indented\t')
  })
})

describe('readContentsReply', () => {
  it('decodes UTF-8 text, names the source and maps lines one to one', () => {
    const source = 'def grüß(name):\r\n    return "héllo, 世界 " + name\r\n'
    const file = loaded(fileReply(source))
    expect(file.text).toBe('def grüß(name):\n    return "héllo, 世界 " + name')
    expect(file.text.split('\n')[1]).toBe('    return "héllo, 世界 " + name')
    expect(file.size).toBe(Buffer.byteLength(source))
    expect(file).toMatchObject({
      owner: 'psf',
      repo: 'requests',
      ref: 'v2.32.3',
      path: 'src/requests/auth.py',
      url: 'https://github.com/psf/requests/blob/v2.32.3/src/requests/auth.py',
      sha: '0123456789abcdef0123456789abcdef01234567',
    })
  })

  it('accepts a file whose bytes exceed the limit but whose characters fit', () => {
    const text = '世'.repeat(MAX_CODE_LENGTH - 10)
    expect(loaded(fileReply(text)).text).toHaveLength(MAX_CODE_LENGTH - 10)
  })

  it('refuses a file over the limit by characters, and says both numbers', () => {
    const result = readContentsReply(fileReply('a'.repeat(MAX_CODE_LENGTH + 1)), REF)
    expect(result).toEqual({
      ok: false,
      error: 'That file has 50,001 characters. CodeLens reviews up to 50,000, so pick a smaller file.',
    })
  })

  it('refuses a huge file by its reported size without decoding it', () => {
    const result = readContentsReply({ ...fileReply('x'), size: 1_048_576, content: '', encoding: 'none' }, REF)
    expect(result).toEqual({
      ok: false,
      error: 'That file is 1024 KB. CodeLens reviews up to 50,000 characters, so pick a smaller file.',
    })
  })

  it.each([
    ['a folder', [{ type: 'file' }], 'That path is a folder. Pick a file.'],
    ['a symlink', fileReply('x', { type: 'symlink' }), 'That path is a symlink, not a file that can be reviewed.'],
    ['an empty file', fileReply('', { size: 0, content: '' }), 'That file is empty.'],
    ['a blank file', fileReply('  \n\n'), 'That file has no code in it.'],
    ['a binary file', fileReply(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])), 'That file is binary or not UTF-8 text, so it cannot be reviewed.'],
    ['invalid UTF-8', fileReply(Uint8Array.from([0xc3, 0x28])), 'That file is binary or not UTF-8 text, so it cannot be reviewed.'],
    ['content that is not base64', fileReply('x', { content: '!!!not base64!!!' }), 'That file is binary or not UTF-8 text, so it cannot be reviewed.'],
    ['no text sent', fileReply('x', { encoding: 'none', content: '' }), 'GitHub did not send the text of that file.'],
    ['a link off github.com', fileReply('x', { html_url: 'https://evil.example/x' }), 'GitHub sent a reply this page could not read.'],
    ['a missing size', fileReply('x', { size: undefined }), 'GitHub sent a reply this page could not read.'],
    ['null', null, 'GitHub sent a reply this page could not read.'],
  ])('refuses %s', (_name, reply, error) => {
    expect(readContentsReply(reply, REF)).toEqual({ ok: false, error })
  })
})

describe('githubFailure', () => {
  const headers = (values: Record<string, string>) => new Headers(values)
  const now = Date.UTC(2026, 9, 9, 12, 0, 0)

  it('says when the anonymous quota resets, rounded up to whole minutes', () => {
    const reset = String(Math.floor(now / 1000) + 4 * 60 + 10)
    expect(githubFailure(403, headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }), now)).toBe(
      'GitHub allows 60 anonymous requests an hour from one address, and this one has used them. Try again in about 5 minutes.',
    )
  })

  it('handles a 429 with no reset header', () => {
    expect(githubFailure(429, headers({}), now)).toBe(
      'GitHub allows 60 anonymous requests an hour from one address, and this one has used them. Try again later.',
    )
  })

  it('does not blame the quota for an ordinary 403', () => {
    expect(githubFailure(403, headers({ 'x-ratelimit-remaining': '41' }), now)).toBe('GitHub refused to serve that file.')
  })

  it('maps 404 and server errors', () => {
    expect(githubFailure(404, headers({}))).toBe(
      'GitHub has no such public file. Check the owner, repository, branch or tag, and path.',
    )
    expect(githubFailure(502, headers({}))).toBe('GitHub is having trouble right now. Try again in a moment.')
    expect(githubFailure(418, headers({}))).toBe('GitHub answered with an unexpected status (418).')
  })
})

describe('formatBytes', () => {
  it('uses bytes, one decimal under 10 KB and whole kilobytes above', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(3390)).toBe('3.3 KB')
    expect(formatBytes(30495)).toBe('30 KB')
  })
})

describe('fetchGitHubFile', () => {
  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

  it('requests the contents API and returns the decoded file', async () => {
    const stub = vi.fn<typeof fetch>().mockResolvedValue(json(fileReply('print("hi")\n')))
    const result = await fetchGitHubFile(REF, undefined, { fetchImpl: stub })
    expect(stub).toHaveBeenCalledTimes(1)
    const [url, init] = stub.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/psf/requests/contents/src/requests/auth.py?ref=v2.32.3')
    expect((init?.headers as Record<string, string>).Accept).toBe('application/vnd.github+json')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(result.ok && result.value.text).toBe('print("hi")')
  })

  it('turns a spent rate limit into the plain message', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 600)
    const stub = vi.fn<typeof fetch>().mockResolvedValue(
      json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } }),
    )
    const result = await fetchGitHubFile(REF, undefined, { fetchImpl: stub })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/^GitHub allows 60 anonymous requests an hour .* about 1[01] minutes\.$/)
  })

  it('reports an unreadable body as unreadable, not as a network failure', async () => {
    const stub = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 200 }))
    expect(await fetchGitHubFile(REF, undefined, { fetchImpl: stub })).toEqual({
      ok: false,
      error: 'GitHub sent a reply this page could not read.',
    })
  })

  it('reports a network failure without throwing', async () => {
    const stub = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await fetchGitHubFile(REF, undefined, { fetchImpl: stub })).toEqual({
      ok: false,
      error: 'Could not reach GitHub. Check your connection and try again.',
    })
  })

  it('gives up with a timeout message when GitHub does not answer', async () => {
    const stub = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    expect(await fetchGitHubFile(REF, undefined, { fetchImpl: stub, timeoutMs: 20 })).toEqual({
      ok: false,
      error: 'GitHub did not answer in time. Try again.',
    })
  })

  it('rethrows a cancel so the caller can ignore it', async () => {
    const controller = new AbortController()
    const stub = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const pending = fetchGitHubFile(REF, controller.signal, { fetchImpl: stub })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
