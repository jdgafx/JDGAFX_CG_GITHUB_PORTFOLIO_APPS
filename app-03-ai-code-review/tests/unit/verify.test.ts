import { describe, expect, it } from 'vitest'
import { fileDoc } from '../../netlify/shared/anchor'
import type { Candidate } from '../../netlify/shared/review'
import { assemble, buildVerifyUser, findEvidence, linesNamed, readVerdicts, settle, type RawVerdict } from '../../netlify/shared/verify'

// gorilla/mux v1.8.1 mux.go lines 375 to 392, copied verbatim. Line 1 here is line 375 there.
const WALK = [
  'func (r *Router) walk(walkFn WalkFunc, ancestors []*Route) error {',
  '\tfor _, t := range r.routes {',
  '\t\terr := walkFn(t, r, ancestors)',
  '\t\tif err == SkipRouter {',
  '\t\t\tcontinue',
  '\t\t}',
  '\t\tif err != nil {',
  '\t\t\treturn err',
  '\t\t}',
  '\t\tfor _, sr := range t.matchers {',
  '\t\t\tif h, ok := sr.(*Router); ok {',
  '\t\t\t\tancestors = append(ancestors, t)',
  '\t\t\t\terr := h.walk(walkFn, ancestors)',
  '\t\t\t\tif err != nil {',
  '\t\t\t\t\treturn err',
  '\t\t\t\t}',
  '\t\t\t\tancestors = ancestors[:len(ancestors)-1]',
  '\t\t\t}',
]
const doc = fileDoc(WALK)

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  id: 1,
  line: 12,
  fromLine: 12,
  quote: 'ancestors = append(ancestors, t)',
  severity: 'warning',
  message: 'Appending to ancestors inside the loop can share a backing array between siblings.',
  suggestion: 'Copy the slice before appending.',
  moveNote: null,
  loweredFrom: null,
  ...over,
})

const verdict = (over: Partial<RawVerdict>): RawVerdict => ({ id: 1, verdict: 'keep', line: 12, evidence: 'ancestors = append(ancestors, t)', reason: 'The append on this line reuses the caller slice.', ...over })

describe('findEvidence', () => {
  it('finds code on the line, ignoring spacing and tabs', () => {
    expect(findEvidence(doc, 'ancestors  =   append(ancestors, t)', 12, 0)).toBe(12)
  })

  it('accepts a copied line-number prefix or a diff sign', () => {
    expect(findEvidence(doc, '12\t| ancestors = append(ancestors, t)', 12, 0)).toBe(12)
    expect(findEvidence(doc, '+ ancestors = append(ancestors, t)', 12, 0)).toBe(12)
  })

  it('finds the nearest line within the window, and nothing beyond it', () => {
    expect(findEvidence(doc, 'ancestors = append(ancestors, t)', 13, 1)).toBe(12)
    expect(findEvidence(doc, 'ancestors = append(ancestors, t)', 16, 1)).toBeNull()
  })

  it('ignores a fragment shorter than three characters', () => {
    expect(findEvidence(doc, 'r', 1, 20)).toBeNull()
  })
})

describe('settle', () => {
  it('keeps a comment whose quoted code is on its line', () => {
    expect(settle(candidate(), verdict({}), doc)).toMatchObject({ verdict: 'kept', decidedBy: 'verifier', line: 12, evidence: 'ancestors = append(ancestors, t)' })
  })

  it('does not call a comment verified when the quote is not on the line it names', () => {
    const s = settle(candidate(), verdict({ evidence: 'return nil, errors.New("x")' }), doc)
    expect(s).toMatchObject({ verdict: 'unverified', decidedBy: 'none', line: 12, evidence: null })
    expect(s.reason).toMatch(/not on line 12/)
  })

  it('moves a comment to the line the second pass names when its quote is there', () => {
    const s = settle(candidate({ line: 11, fromLine: 11, quote: '' }), verdict({ line: 12 }), doc)
    expect(s).toMatchObject({ verdict: 'moved', line: 12 })
  })

  it('counts a move back to the cited line as kept', () => {
    const s = settle(candidate({ line: 13, fromLine: 12, quote: '' }), verdict({ line: 12 }), doc)
    expect(s).toMatchObject({ verdict: 'kept', line: 12 })
  })

  it('refuses a move to a line that has none of the quoted code (mux walk: 391 to the signature)', () => {
    // The first pass quoted the append on line 12; the live second pass moved it to the signature on line 1.
    const s = settle(candidate({ quote: 'ancestors = ancestors[:len(ancestors)-1]', line: 17, fromLine: 17 }), verdict({ line: 1, evidence: 'func (r *Router) walk(walkFn WalkFunc, ancestors []*Route) error {' }), doc)
    expect(s).toMatchObject({ verdict: 'unverified', line: 17 })
    expect(s.reason).toMatch(/away from the code it quotes on line 17/)
  })

  it('refuses a move further than 25 lines or outside the file', () => {
    expect(settle(candidate(), verdict({ line: 99 }), doc).verdict).toBe('unverified')
    expect(settle(candidate(), verdict({ line: 0 }), doc).verdict).toBe('unverified')
  })

  it('refuses a move onto a blank line', () => {
    const withBlank = fileDoc(['a := 1', '', 'b := 2'])
    const s = settle(candidate({ line: 1, fromLine: 1, quote: '' }), verdict({ line: 2, evidence: 'a := 1' }), withBlank)
    expect(s.verdict).toBe('unverified')
  })

  it('drops a comment when the evidence for the drop is in the code, and keeps the reason', () => {
    const s = settle(candidate(), verdict({ verdict: 'drop', evidence: 'ancestors = ancestors[:len(ancestors)-1]', reason: 'It truncates back, so siblings do not overlap.' }), doc)
    expect(s).toMatchObject({ verdict: 'dropped', decidedBy: 'verifier', reason: 'It truncates back, so siblings do not overlap.' })
  })

  it('does not drop on evidence that is nowhere in the code', () => {
    expect(settle(candidate(), verdict({ verdict: 'drop', evidence: 'defer mu.Unlock()' }), doc).verdict).toBe('unverified')
  })

  it('treats a missing verdict or an unknown word as unverified', () => {
    expect(settle(candidate(), undefined, doc).verdict).toBe('unverified')
    expect(settle(candidate(), verdict({ verdict: 'maybe' }), doc).verdict).toBe('unverified')
  })
})

describe('linesNamed and the reason-line check', () => {
  it('reads single lines, ranges and pairs', () => {
    expect(linesNamed('Line 205 uses SHA-1')).toEqual([205])
    expect(linesNamed('Lines 84-89 build a list, repeated at lines 305 and 306')).toEqual([84, 85, 86, 87, 88, 89, 305, 306])
    expect(linesNamed('No numbers here')).toEqual([])
    expect(linesNamed('The append at 386 and 395 may alias')).toEqual([386, 395])
    expect(linesNamed('truncated at 16 hex characters on line 205 or at 3 ms')).toEqual([205])
  })

  // requests v2.32.3 auth.py lines 198 to 206 with the live message and reason of the comment that sat on line 200.
  const AUTH = fileDoc([
    '        ncvalue = f"{self._thread_local.nonce_count:08x}"',
    '        s = str(self._thread_local.nonce_count).encode("utf-8")',
    '        s += nonce.encode("utf-8")',
    '        s += time.ctime().encode("utf-8")',
    '        s += os.urandom(8)',
    '',
    '        cnonce = hashlib.sha1(s).hexdigest()[:16]',
  ])
  const sha = candidate({ line: 2, fromLine: 2, quote: 'self._thread_local.nonce_count', message: 'The cnonce is built from a SHA-1 hash of predictable values plus os.urandom, and SHA-1 is used here for a value that should be unpredictable.' })
  const shaVerdict = (reason: string) => verdict({ line: 2, evidence: 's = str(self._thread_local.nonce_count).encode("utf-8")', reason })

  it('does not confirm a comment whose reason points at the line that holds the code its message names (SHA-1: on 200, reason says 205)', () => {
    const s = settle(sha, shaVerdict('cnonce at line 7 is a SHA-1 of mostly predictable values plus urandom, which is a real weakness.'), AUTH)
    expect(s).toMatchObject({ verdict: 'unverified', line: 2 })
    expect(s.reason).toBe("Not confirmed: the second pass's reason points at line 7, but the comment sits on line 2.")
  })

  it('lets a reason cite other lines for context when it also names the comment line, or the comment sits where its code is', () => {
    expect(settle(candidate(), verdict({ reason: 'The inner err shadows the outer err from line 3, and the warning is accurate.' }), doc).verdict).toBe('kept')
    expect(settle(sha, shaVerdict('Line 7 uses hashlib.sha1 for the nonce built on line 2.'), AUTH).verdict).toBe('kept')
  })

  it('does not confirm a comment on a function signature whose reason points only at lines of its body (mux walk: 375 says 386 and 395)', () => {
    const s = settle(
      candidate({ line: 1, fromLine: 1, quote: '', message: 'Appending to ancestors inside the loop can alias the caller backing array.' }),
      verdict({ line: 1, evidence: 'func (r *Router) walk(walkFn WalkFunc, ancestors []*Route) error {', reason: 'The append at 12 and the truncation at 17 may write into a shared backing array.' }),
      doc,
    )
    expect(s).toMatchObject({ verdict: 'unverified', line: 1 })
    const named = settle(candidate({ line: 1, fromLine: 1, quote: '', message: 'm' }), verdict({ line: 1, evidence: 'func (r *Router) walk(walkFn WalkFunc, ancestors []*Route) error {', reason: 'The append at line 12 may alias the slice.' }), doc)
    expect(named.verdict).toBe('unverified')
    const plain = settle(candidate({ line: 1, fromLine: 1, quote: '', message: 'm' }), verdict({ line: 1, evidence: 'func (r *Router) walk(walkFn WalkFunc, ancestors []*Route) error {', reason: 'This function walks every route and is long.' }), doc)
    expect(plain.verdict).toBe('kept')
  })

  it('confirms the SHA-1 comment when it sits on the sha1 line itself', () => {
    const onSha = candidate({ ...sha, line: 7, fromLine: 7 })
    expect(settle(onSha, verdict({ line: 7, evidence: 'cnonce = hashlib.sha1(s).hexdigest()[:16]', reason: 'Line 7 uses SHA-1 for the nonce.' }), AUTH).verdict).toBe('kept')
  })
})

describe('readVerdicts', () => {
  const item = '{"id":1,"verdict":"keep","line":12,"evidence":"x := 1","reason":"ok"}'

  it('reads the bare array the live model returns', () => {
    expect(readVerdicts(`[${item}]`)?.get(1)).toMatchObject({ verdict: 'keep', line: 12 })
  })

  it('reads an object with a verdicts array, inside a code fence', () => {
    expect(readVerdicts('```json\n{"verdicts":[' + item + ']}\n```')?.get(1)?.reason).toBe('ok')
  })

  it('keeps the first verdict for an id and ignores items that are not verdicts', () => {
    const map = readVerdicts(`[${item},{"id":1,"verdict":"drop"},"junk",{"verdict":"keep"}]`)
    expect(map?.size).toBe(1)
    expect(map?.get(1)?.verdict).toBe('keep')
  })

  it('returns null for a reply with no list', () => {
    expect(readVerdicts('I could not do that')).toBeNull()
    expect(readVerdicts('{"comments":[]}')).toBeNull()
  })
})

describe('assemble', () => {
  const locate = (line: number) => ({ text: WALK[line - 1], where: null })
  const drop = { id: 2, line: 3, fromLine: 3, severity: 'info' as const, message: 'm', suggestion: 's', reason: 'Proposes no change: "Leave as-is"' }

  it('lists every first-pass comment once: settled, then dropped by the checks, in first-pass order', () => {
    const verdicts = new Map([[1, verdict({})]])
    const list = assemble([candidate()], [drop], verdicts, doc, locate)
    expect(list.map((c) => [c.id, c.verdict, c.decidedBy])).toEqual([[1, 'kept', 'verifier'], [2, 'dropped', 'check']])
    expect(list[0]).not.toHaveProperty('quote')
    expect(list[0].code).toBe(WALK[11])
  })

  it('says so in the reason when the checks lowered the severity', () => {
    const list = assemble([candidate({ severity: 'info', loweredFrom: 'critical' })], [], new Map([[1, verdict({})]]), doc, locate)
    expect(list[0]).toMatchObject({ severity: 'info', verdict: 'kept' })
    expect(list[0].reason).toMatch(/Severity lowered from critical: the comment itself says the code is safe\.$/)
  })

  it('shows every surviving comment as unverified when the second pass did not finish', () => {
    const list = assemble([candidate()], [drop], null, doc, locate)
    expect(list.map((c) => c.verdict)).toEqual(['unverified', 'dropped'])
    expect(list[0].reason).toMatch(/second pass did not finish/)
  })
})

describe('buildVerifyUser', () => {
  it('gives each comment its id and the numbered lines around it', () => {
    const text = buildVerifyUser('1\t| a', [candidate({ line: 3 })], WALK)
    const comments = JSON.parse(text.slice(text.indexOf('['))) as Array<{ id: number; nearby: string }>
    expect(comments[0].id).toBe(1)
    expect(comments[0].nearby.split('\n')[0]).toBe(`1\t| ${WALK[0]}`)
    expect(comments[0].nearby).toContain('9\t|')
  })

  it('shows the second pass both the line the first pass cited and the line a check moved the comment to', () => {
    const text = buildVerifyUser('', [candidate({ line: 12, fromLine: 4 })], WALK)
    const [comment] = JSON.parse(text.slice(text.indexOf('['))) as Array<{ firstPassLine: number; firstPassNearby: string; nearby: string; note: string }>
    expect(comment.firstPassLine).toBe(4)
    expect(comment.firstPassNearby).toContain(`4\t| ${WALK[3]}`)
    expect(comment.nearby).toContain(`12\t| ${WALK[11]}`)
    expect(comment.note).toBe('The first pass cited line 4; an automatic check moved the comment to line 12. Answer with the line the comment is really about, which may be either.')
  })

  it('adds nothing about a first-pass line when the comment was not moved', () => {
    const text = buildVerifyUser('', [candidate()], WALK)
    expect(text).not.toContain('firstPassLine')
  })
})
