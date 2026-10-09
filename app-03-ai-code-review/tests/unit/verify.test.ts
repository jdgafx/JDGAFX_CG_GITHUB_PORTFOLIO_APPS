import { describe, expect, it } from 'vitest'
import { anchorLine, diffDoc, fileDoc } from '../../netlify/shared/anchor'
import type { Candidate } from '../../netlify/shared/review'
import { assemble, buildVerifyUser, combineReads, findEvidence, linesNamed, readVerdicts, settle, settleRebuttal, translateLines, type RawVerdict } from '../../netlify/shared/verify'

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

const verdict = (over: Partial<RawVerdict>): RawVerdict => ({ id: 1, verdict: 'keep', line: 12, evidence: 'ancestors = append(ancestors, t)', support: 'ancestors = append(ancestors, t)', reason: 'The append on this line reuses the caller slice.', ...over })

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

describe('two quotes: the cited line and the code that makes the claim true', () => {
  it('keeps a comment and records the supporting code and the line it is on', () => {
    const s = settle(candidate(), verdict({ support: 'err := walkFn(t, r, ancestors)' }), doc)
    expect(s).toMatchObject({ verdict: 'kept', support: 'err := walkFn(t, r, ancestors)', supportAt: 3 })
  })

  it('does not confirm a claim for which no supporting code is quoted', () => {
    const s = settle(candidate(), verdict({ support: '' }), doc)
    expect(s).toMatchObject({ verdict: 'unverified', support: null })
    expect(s.reason).toBe('Not confirmed: the second pass could not quote the code that shows the claim is true.')
  })

  it('does not confirm a claim whose supporting code is not in the file (the live utils.py "_f is None" case)', () => {
    const s = settle(candidate(), verdict({ support: 'self._f = None  # set by a failed open' }), doc)
    expect(s.verdict).toBe('unverified')
    expect(s.reason).toBe('Not confirmed: the second pass gave "self._f = None # set by a failed open" as the code that shows the claim, which is not in the code.')
  })

  it('shows an "unsure" verdict as not confirmed with what the claim rests on', () => {
    const s = settle(candidate(), verdict({ verdict: 'unsure', reason: 'It depends on what os.path.expanduser does on this Python version.' }), doc)
    expect(s).toMatchObject({ verdict: 'unverified', decidedBy: 'none' })
    expect(s.reason).toBe('Cannot be confirmed from the code: It depends on what os.path.expanduser does on this Python version.')
  })
})

describe('a move keeps the comment on its subject', () => {
  // mux.go v1.8.1 lines 175 to 182: the declaration of path and, five lines later, its use in a call to cleanPath.
  const MUX = fileDoc([
    '	if !r.skipClean {',
    '		path := req.URL.Path',
    '		if r.useEncodedPath {',
    '			path = req.URL.EscapedPath()',
    '		}',
    '		// Clean path to canonical form and redirect.',
    '		if p := cleanPath(path); p != path {',
  ])
  const message = 'The local variable path shadows the imported package path used later in cleanPath.'

  it('keeps a shadowing comment on the line that declares the name, instead of moving it to a use', () => {
    expect(anchorLine(MUX, 2, 'path := req.URL.Path', message)).toEqual({ line: 2, movedBy: null })
  })

  it('refuses a second-pass move off that declaration', () => {
    const c = candidate({ line: 2, fromLine: 2, quote: 'path := req.URL.Path', message })
    const s = settle(c, verdict({ verdict: 'move', line: 7, evidence: 'if p := cleanPath(path); p != path {', support: 'if p := cleanPath(path); p != path {' }), MUX)
    expect(s).toMatchObject({ verdict: 'unverified', line: 2 })
    expect(s.reason).toBe('Not confirmed: the second pass moved it to line 7, away from the line that declares path, which the comment is about.')
  })

  it('still lets a comment about an assertion move off the line that declares rv (mux Vars, 431 to 432)', () => {
    const vars = fileDoc(['if rv := r.Context().Value(varsKey); rv != nil {', '    return rv.(map[string]string)', '}'])
    const c = candidate({ line: 1, fromLine: 1, quote: '', message: 'The unchecked type assertion rv.(map[string]string) panics if another value is stored.' })
    const s = settle(c, verdict({ verdict: 'move', line: 2, evidence: 'return rv.(map[string]string)', support: 'return rv.(map[string]string)' }), vars)
    expect(s).toMatchObject({ verdict: 'moved', line: 2 })
  })

  it('refuses a move from an added line to a removed one (redux 448 to 447), but allows moving back to the cited line', () => {
    const d = diffDoc([
      { text: '', kind: 'meta' },
      { text: '[Reselect](https://reselect.js.org/)', kind: 'del' },
      { text: '[Reselect](https://redux.js.org/reselect/)', kind: 'add' },
    ])
    const c = candidate({ line: 3, fromLine: 3, quote: '', message: 'The link text is a made-up URL.' })
    const away = settle(c, verdict({ verdict: 'move', line: 2, evidence: '[Reselect](https://reselect.js.org/)', support: '[Reselect](https://reselect.js.org/)' }), d)
    expect(away).toMatchObject({ verdict: 'unverified', line: 3 })
    expect(away.reason).toMatch(/other side of the change/)
    const back = settle({ ...c, line: 2, fromLine: 3 }, verdict({ verdict: 'move', line: 3, evidence: '[Reselect](https://redux.js.org/reselect/)', support: '[Reselect](https://redux.js.org/reselect/)' }), d)
    expect(back.verdict).toBe('kept')
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
  const shaVerdict = (reason: string) => verdict({ line: 2, evidence: 's = str(self._thread_local.nonce_count).encode("utf-8")', support: 'cnonce = hashlib.sha1(s).hexdigest()[:16]', reason })

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
    expect(settle(onSha, verdict({ line: 7, evidence: 'cnonce = hashlib.sha1(s).hexdigest()[:16]', support: 'cnonce = hashlib.sha1(s).hexdigest()[:16]', reason: 'Line 7 uses SHA-1 for the nonce.' }), AUTH).verdict).toBe('kept')
  })
})

/** Both reads, the adversary answering "stands" with a quote from the code, for every comment the first read has. */
const pair = (first: Map<number, RawVerdict>): [Map<number, RawVerdict>, Map<number, RawVerdict>] => [
  first,
  new Map([...first].map(([id, v]) => [id, { ...v, verdict: 'stands', support: '' }])),
]

describe('translateLines: pull request reasons use file lines, not diff positions', () => {
  // Recorded from gorilla/mux#731: diff position 9 is mux.go new line 25, 60 is route_test.go 18, 80 to 92 are route_test.go 43 to 55.
  const where = (file: string, line: number) => ({ text: '', where: { file, line, side: 'new' as const } })
  const map: Record<number, ReturnType<typeof where>> = { 9: where('mux.go', 25), 60: where('route_test.go', 18), 80: where('route_test.go', 43), 92: where('route_test.go', 55), 1: where('mux.go', 0) }
  const locate = (n: number) => map[n] ?? { text: '', where: null }

  it('turns the live reasons into file lines', () => {
    expect(translateLines('Line 9 declares a mutable exported package variable read by the router.', locate)).toBe('mux.go:25 declares a mutable exported package variable read by the router.')
    expect(translateLines('Line 60 writes the global without synchronization.', locate)).toBe('route_test.go:18 writes the global without synchronization.')
    expect(translateLines('The closure on lines 80-92 writes to the cache map with no lock.', locate)).toBe('The closure on route_test.go:43-55 writes to the cache map with no lock.')
  })

  it('names the file for a header position, and handles "at N and M"', () => {
    expect(translateLines('Line 1 starts the file.', locate)).toBe('mux.go starts the file.')
    expect(translateLines('The append at 9 and 60 may alias.', locate)).toBe('The append at mux.go:25 and route_test.go:18 may alias.')
  })

  it('leaves a position that cannot be placed, and sizes and counts, as they were', () => {
    expect(translateLines('Line 999 is outside; truncated at 16 hex characters.', locate)).toBe('Line 999 is outside; truncated at 16 hex characters.')
  })

  it('rewrites the diff position in a not-confirmed reason too (live: "not on line 1281" on a card at tables.go:59)', () => {
    expect(translateLines('Not confirmed: the second pass quoted "t.byName[f.Name] = id", which is not on line 9.', locate)).toBe('Not confirmed: the second pass quoted "t.byName[f.Name] = id", which is not on mux.go:25.')
  })

  it('is applied by assemble for a pull request and not for a file', () => {
    const verdicts = pair(new Map([[1, verdict({ reason: 'Line 12 appends to ancestors.' })]]))
    const lines = (flag: boolean) => assemble([candidate()], [], verdicts, doc, (n) => (n === 12 ? where('mux.go', 25) : { text: WALK[n - 1], where: null }), flag)[0].reason
    expect(lines(true)).toBe('mux.go:25 appends to ancestors.')
    expect(lines(false)).toBe('Line 12 appends to ancestors.')
  })
})

describe('combineReads: the first read tested by an adversary', () => {
  const kept = settle(candidate(), verdict({}), doc)
  const stands = settleRebuttal({ ...verdict({ verdict: 'stands', support: '' }) }, doc)

  it('keeps a comment only when the adversary finds nothing against it', () => {
    expect(combineReads(candidate(), kept, stands)).toBe(kept)
  })

  it('does not confirm a comment the adversary refuted with real code, and says what it found', () => {
    const refuted = settleRebuttal(verdict({ verdict: 'refuted', evidence: 'err := walkFn(t, r, ancestors)', reason: 'The walk function is called with the slice first.' }), doc)
    const s = combineReads(candidate(), kept, refuted)
    expect(s).toMatchObject({ verdict: 'unverified', decidedBy: 'none' })
    expect(s.reason).toBe('A second read looked for code that breaks the claim and found some: "err := walkFn(t, r, ancestors)". The walk function is called with the slice first.')
  })

  it('treats an adversary whose quote is not in the file, or who is unsure, or is missing, as unconfirming', () => {
    const invented = settleRebuttal(verdict({ verdict: 'stands', evidence: 'defer mu.Unlock()' }), doc)
    expect(invented.state).toBe('unsure')
    expect(combineReads(candidate(), kept, invented).verdict).toBe('unverified')
    expect(combineReads(candidate(), kept, settleRebuttal(verdict({ verdict: 'unsure', reason: 'depends on a library' }), doc)).verdict).toBe('unverified')
    expect(combineReads(candidate(), kept, settleRebuttal(undefined, doc)).verdict).toBe('unverified')
    expect(combineReads(candidate(), kept, null).reason).toBe('The adversarial read did not finish, so this comment is not confirmed.')
  })

  it('lets a first-read drop or doubt stand on its own, and a missing first read leave everything unconfirmed', () => {
    const dropped = settle(candidate(), verdict({ verdict: 'drop', evidence: 'ancestors = ancestors[:len(ancestors)-1]' }), doc)
    expect(combineReads(candidate(), dropped, null)).toBe(dropped)
    const unsure = settle(candidate(), verdict({ verdict: 'unsure', reason: 'depends on the caller' }), doc)
    expect(combineReads(candidate(), unsure, stands)).toBe(unsure)
    expect(combineReads(candidate(), null, stands).reason).toMatch(/second pass did not finish/)
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
    const list = assemble([candidate()], [drop], pair(new Map([[1, verdict({})]])), doc, locate)
    expect(list.map((c) => [c.id, c.verdict, c.decidedBy])).toEqual([[1, 'kept', 'verifier'], [2, 'dropped', 'check']])
    expect(list[0]).not.toHaveProperty('quote')
    expect(list[0].code).toBe(WALK[11])
  })

  it('says so in the reason when the checks lowered the severity', () => {
    const list = assemble([candidate({ severity: 'info', loweredFrom: 'critical' })], [], pair(new Map([[1, verdict({})]])), doc, locate)
    expect(list[0]).toMatchObject({ severity: 'info', verdict: 'kept' })
    expect(list[0].reason).toMatch(/Severity lowered from critical: the comment itself says the code is safe\.$/)
  })

  it('shows every surviving comment as unverified when the second pass did not finish', () => {
    const list = assemble([candidate()], [drop], [null, null], doc, locate)
    expect(list.map((c) => c.verdict)).toEqual(['unverified', 'dropped'])
    expect(list[0].reason).toMatch(/second pass did not finish/)
  })
})

describe('buildVerifyUser', () => {
  const parse = (text: string) => JSON.parse(text.slice(text.indexOf('['))) as Array<{ id: number; scope: string; firstPassLine?: number; firstPassScope?: string; note?: string }>

  it('gives each comment its id and the numbered function that holds its line', () => {
    const [comment] = parse(buildVerifyUser('1\t| a', [candidate({ line: 12 })], WALK))
    expect(comment.id).toBe(1)
    expect(comment.scope.split('\n')[0]).toBe(`1\t| ${WALK[0]}`)
    expect(comment.scope).toContain(`12\t| ${WALK[11]}`)
  })

  it('shows the second pass both the line the first pass cited and the line a check moved the comment to', () => {
    const [comment] = parse(buildVerifyUser('', [candidate({ line: 12, fromLine: 4 })], WALK))
    expect(comment.firstPassLine).toBe(4)
    expect(comment.firstPassScope).toContain(`4\t| ${WALK[3]}`)
    expect(comment.scope).toContain(`12\t| ${WALK[11]}`)
    expect(comment.note).toBe('The first pass cited line 4; an automatic check moved the comment to line 12. Answer with the line the comment is really about, which may be either.')
  })

  it('adds nothing about a first-pass line when the comment was not moved', () => {
    expect(buildVerifyUser('', [candidate()], WALK)).not.toContain('firstPassLine')
  })
})

describe('a move never leaves its file (flask#5928: a changelog comment moved into docs/appcontext.rst)', () => {
  const d = diffDoc([
    { text: '', kind: 'meta', file: 'CHANGES.rst' },
    { text: '- Teardown errors are raised together.', kind: 'add', file: 'CHANGES.rst' },
    { text: '', kind: 'meta', file: 'docs/appcontext.rst' },
    { text: 'The context raises the errors it collected.', kind: 'add', file: 'docs/appcontext.rst' },
  ])
  const c = candidate({ line: 2, fromLine: 2, quote: '', message: 'The changelog entry does not mention ExceptionGroup.' })

  it('refuses the second pass moving a comment to a line of another file', () => {
    const s = settle(c, verdict({ verdict: 'move', line: 4, evidence: 'The context raises the errors it collected.', support: 'The context raises the errors it collected.' }), d)
    expect(s).toMatchObject({ verdict: 'unverified', line: 2 })
    expect(s.reason).toBe('Not confirmed: the second pass moved it to line 4, which is in another file.')
  })

  it('does not let the checks pull a comment to a line of another file by name', () => {
    expect(anchorLine(d, 2, '', 'The ExceptionGroup context raises errors it collected.')).toEqual({ line: 2, movedBy: null })
  })
})
