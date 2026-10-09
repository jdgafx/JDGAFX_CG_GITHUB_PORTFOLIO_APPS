import { describe, expect, it } from 'vitest'
import { accountFiles, buildDiff, defaultSelection, isGenerated, parsePatch } from '../../netlify/shared/diff'

// The first file of psf/requests pull request 6963, as the GitHub files API returned it.
const UTILS_PATCH = `@@ -219,14 +219,7 @@ def get_netrc_auth(url, raise_errors=False):
         netrc_path = None
 
         for f in netrc_locations:
-            try:
-                loc = os.path.expanduser(f)
-            except KeyError:
-                # os.path.expanduser can fail when $HOME is undefined and
-                # getpwuid fails. See https://bugs.python.org/issue20164 &
-                # https://github.com/psf/requests/issues/1846
-                return
-
+            loc = os.path.expanduser(f)
             if os.path.exists(loc):
                 netrc_path = loc
                 break`

describe('parsePatch', () => {
  const units = parsePatch('src/requests/utils.py', UTILS_PATCH)

  it('numbers the new side from the hunk header and the old side for removed lines', () => {
    const added = units.find((u) => u.kind === 'add')
    expect(added).toMatchObject({ text: '            loc = os.path.expanduser(f)', newLine: 222, oldLine: null, file: 'src/requests/utils.py' })
    const firstRemoved = units.find((u) => u.kind === 'del')
    expect(firstRemoved).toMatchObject({ text: '            try:', oldLine: 222, newLine: null })
  })

  it('reads the hunk header as a meta line that can never carry a comment', () => {
    expect(units[0]).toMatchObject({ kind: 'meta', text: '' })
    expect(units[0].shown.startsWith('@@ -219,14 +219,7 @@')).toBe(true)
  })

  it('keeps unchanged lines as context, including an empty one', () => {
    const kinds = units.map((u) => u.kind)
    expect(kinds.filter((k) => k === 'add')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'del')).toHaveLength(8)
    expect(units[2]).toMatchObject({ kind: 'ctx', text: '', newLine: 220, oldLine: 220 })
  })

  it('skips the "No newline at end of file" marker', () => {
    const marked = parsePatch('a.txt', '@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new')
    expect(marked.map((u) => u.kind)).toEqual(['meta', 'del', 'add'])
  })
})

describe('buildDiff', () => {
  const built = buildDiff([{ path: 'src/requests/utils.py', status: 'modified', patch: UTILS_PATCH }])

  it('starts each file with a header line and counts only added and removed lines', () => {
    expect(built.units[0]).toMatchObject({ kind: 'meta', shown: '=== src/requests/utils.py (modified)' })
    expect(built.changed).toBe(9)
  })

  it('counts characters as the numbered text, one break per line', () => {
    expect(built.chars).toBe(built.units.reduce((n, u) => n + u.shown.length + 1, 0))
  })
})

describe('file selection and the character limit', () => {
  const big = (n: number) => ({ path: `big${n}.ts`, status: 'modified', patch: `@@ -1 +1 @@\n-${'a'.repeat(600)}\n+${'b'.repeat(600)}` })
  const small = { path: 'small.ts', status: 'modified', patch: '@@ -1 +1 @@\n-x\n+y' }
  const files = [big(1), big(2), small, { path: 'logo.png', status: 'added', patch: null }, { path: 'package-lock.json', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }]

  it('takes whole files in order while each still fits, and never a cut piece', () => {
    const picked = defaultSelection(files, 1500)
    expect([...picked]).toEqual(['big1.ts', 'small.ts'])
  })

  it('says why every other file is out', () => {
    const account = accountFiles(files, defaultSelection(files, 1500), 1500)
    expect(account.files.map((f) => [f.path, f.included, f.skipped])).toEqual([
      ['big1.ts', true, null],
      ['big2.ts', false, 'not-selected'],
      ['small.ts', true, null],
      ['logo.png', false, 'no-patch'],
      ['package-lock.json', false, 'generated'],
    ])
    expect(account.filesIncluded).toBe(2)
    expect(account.filesTotal).toBe(5)
    expect(account.changedIncluded).toBe(4)
  })

  it('marks a single file larger than the whole limit as too large', () => {
    const account = accountFiles([big(1)], new Set(), 500)
    expect(account.files[0]).toMatchObject({ included: false, skipped: 'too-large' })
  })

  it('recognises lockfiles and minified output as generated', () => {
    expect(isGenerated('web/yarn.lock')).toBe(true)
    expect(isGenerated('dist/app.min.js')).toBe(true)
    expect(isGenerated('src/app.ts')).toBe(false)
  })
})
