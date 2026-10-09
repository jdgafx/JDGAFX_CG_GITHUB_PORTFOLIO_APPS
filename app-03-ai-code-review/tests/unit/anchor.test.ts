import { describe, expect, it } from 'vitest'
import { anchorLine, codeNames, diffDoc, endsWithNoChangeVerdict, fileDoc, suggestionLeavesCode } from '../../netlify/shared/anchor'
import { parsePatch } from '../../netlify/shared/diff'

// Real suggestions the live model wrote for gorilla/mux v1.8.1 (verifier report app-03d, runs 3 to 6).
describe('suggestionLeavesCode', () => {
  it.each([
    'Leave it in place for backwards compatibility but mark the deprecation clearly in godoc',
    'Leave the deprecation notice in place and plan removal in the next major version',
    'Leave as-is for backward compatibility, but consider removing it in the next major version.',
    'Leave the signature as-is since it must match http.HandlerFunc, or use the blank identifier _',
    'No change needed; the parameter must stay to satisfy http.HandlerFunc.',
    'Keep it as is.',
  ])('is true for %j', (s) => expect(suggestionLeavesCode(s)).toBe(true))

  it.each([
    'Rename it to _ to show that it is unused.',
    'Restore the try/except KeyError block around os.path.expanduser',
    'Keep a copy of the slice before appending, so siblings do not share the backing array.',
    'Pass nil instead: return r.walk(walkFn, nil).',
  ])('is false for %j', (s) => expect(suggestionLeavesCode(s)).toBe(false))
})

describe('endsWithNoChangeVerdict: compatibility shims', () => {
  it('reads "kept only for compatibility" as a no-change verdict (mux KeepContext)', () => {
    expect(endsWithNoChangeVerdict('KeepContext is an exported, deprecated field with no effect, kept only for compatibility.')).toBe(true)
  })

  it('does not read a compatibility note that asks for a change', () => {
    expect(endsWithNoChangeVerdict('The field is kept for compatibility but should be removed in v2.')).toBe(false)
  })
})

describe('codeNames: digests', () => {
  it('turns SHA-1 in prose into the call that uses it', () => {
    expect(codeNames('The cnonce is built with SHA-1, which is a dated choice.')).toContain('sha1')
    expect(codeNames('MD5 is used for the digest')).toContain('md5')
  })

  it('moves a SHA-1 comment to the hashlib.sha1 line four lines below the code it cited (requests auth.py)', () => {
    // Lines 197 to 203 of requests v2.32.3 src/requests/auth.py, copied verbatim.
    const lines = Array.from({ length: 214 }, () => '')
    const real = [
      '        ncvalue = f"{self._thread_local.nonce_count:08x}"',
      '        s = str(self._thread_local.nonce_count).encode("utf-8")',
      '        s += nonce.encode("utf-8")',
      '        s += time.ctime().encode("utf-8")',
      '        s += os.urandom(8)',
      '',
      '        cnonce = hashlib.sha1(s).hexdigest()[:16]',
    ]
    real.forEach((text, i) => (lines[198 + i - 1] = text))
    const anchor = anchorLine(fileDoc(lines), 200, 'self._thread_local.nonce_count', 'The cnonce is built from SHA-1, which is a dated hash.')
    expect(anchor).toEqual({ line: 204, movedBy: 'name' })
    expect(lines[203]).toContain('hashlib.sha1')
  })
})

describe('anchorLine on a pull request diff', () => {
  const patch = '@@ -10,4 +10,4 @@ func f() {\n \tkeep := 1\n-\told := compute()\n+\tfresh := compute()\n \treturn keep'
  // Line 1 is the file header, as buildDiff numbers it; the hunk header is line 2.
  const units = [{ text: '', kind: 'meta' as const }, ...parsePatch('f.go', patch)]
  const doc = diffDoc(units)

  it('refuses a comment on unchanged context', () => {
    expect(anchorLine(doc, 3, '', 'keep is never used again')).toEqual({ dropped: 'context' })
  })

  it('refuses a comment on a hunk header', () => {
    expect(anchorLine(doc, 2, '', 'something about the block')).toEqual({ dropped: 'blank' })
  })

  it('moves a comment from context to the changed line that holds its quote', () => {
    expect(anchorLine(doc, 3, 'fresh := compute()', 'fresh is computed twice')).toMatchObject({ line: 5 })
  })

  it('keeps a comment on an added line', () => {
    expect(anchorLine(doc, 5, 'compute()', 'compute can fail')).toEqual({ line: 5, movedBy: null })
  })
})
