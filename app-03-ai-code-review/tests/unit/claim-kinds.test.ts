import { describe, expect, it } from 'vitest'
import { diffDoc, fileDoc } from '../../netlify/shared/anchor'
import type { Candidate } from '../../netlify/shared/review'
import { buildVerifyPrompt, readVerdicts, settle } from '../../netlify/shared/verify'

// One test group per claim kind: the second pass types its claim, and the code checks that type against the file text.
// Every message here is deliberately neutral: nothing in the prose decides anything, only the typed claim and the file.
const run = (lines: string[], line: number, claim: unknown, over: { support?: string; line?: number } = {}) => {
  const doc = fileDoc(lines)
  const evidence = lines[line - 1].trim()
  const c: Candidate = { id: 1, line, fromLine: line, quote: evidence, severity: 'info', message: 'Look at this line.', suggestion: 'Change this line.', moveNote: null, loweredFrom: null }
  const item = { id: 1, verdict: 'keep', line: over.line ?? line, evidence, support: over.support ?? evidence, reason: 'The line shows it.', claim }
  return settle(c, readVerdicts(JSON.stringify({ verdicts: [item] }))?.get(1), doc)
}
const claim = (kind: string, line: number, lines: string[], names: string[] = [], quote?: string) => ({ kind, names, lines: [line], quote: quote ?? lines[line - 1].trim() })

describe('the claim itself', () => {
  const L = ['x = 1', 'y = 2', 'z = x + y']
  it('is required: a keep with no typed claim is Not confirmed, never defaulted', () => {
    expect(run(L, 3, undefined)).toMatchObject({ verdict: 'unverified' })
    expect(run(L, 3, 'shadows')).toMatchObject({ verdict: 'unverified' })
    expect(run(L, 3, { kind: 'typo', names: [], lines: [3], quote: 'z = x + y' })).toMatchObject({ verdict: 'unverified' })
    expect(run(L, 3, { kind: 'other', names: [], lines: [], quote: 'z = x + y' }).reason).toMatch(/named no line/)
  })

  it('must cite lines at the comment, and the quote must be verbatim there', () => {
    expect(run(L, 3, { kind: 'other', names: [], lines: [1], quote: 'x = 1' })).toMatchObject({ verdict: 'unverified' })
    expect(run(L, 3, { kind: 'other', names: [], lines: [99], quote: 'z = x + y' })).toMatchObject({ verdict: 'unverified' })
    expect(run(L, 3, { kind: 'other', names: [], lines: [3, 99], quote: 'z = x + y' }).reason).toMatch(/line 99, which is outside the file/)
    const wrong = run(L, 3, { kind: 'other', names: [], lines: [3], quote: 'z = x - y' })
    expect(wrong).toMatchObject({ verdict: 'unverified' })
    expect(wrong.reason).toMatch(/z = x - y/)
  })

  it("'other' is confirmed by the quote alone, and says so", () => {
    expect(run(L, 3, { kind: 'other', names: [], lines: [3], quote: 'z =   x + y' })).toMatchObject({ verdict: 'kept', claimKind: 'other' })
  })
})

describe('shadows: the shadowed name must be an import or an outer declaration', () => {
  it('accepts a local that shadows an import, including a two-letter one', () => {
    const go = ['package main', 'import "os"', '', 'func run(args []string) {', '\tos := len(args)', '\t_ = os', '}']
    expect(run(go, 5, claim('shadows', 5, go, ['os']))).toMatchObject({ verdict: 'kept', claimKind: 'shadows' })
  })

  it('accepts a local that shadows a parameter of the enclosing function', () => {
    const ts = ['function total(items: number[], count: number) {', '  for (const item of items) {', '    const count = item * 2', '    use(count)', '  }', '}']
    expect(run(ts, 3, claim('shadows', 3, ts, ['count']))).toMatchObject({ verdict: 'kept' })
  })

  it('rejects a name that nothing outside the line declares', () => {
    const go = ['package main', 'import "net/http"', '', 'func run(req *http.Request) {', '\turl := *req.URL', '\turl.Path = "/"', '}']
    const s = run(go, 5, claim('shadows', 5, go, ['url']))
    expect(s.verdict).toBe('unverified')
    expect(s.reason).toMatch(/url/)
  })

  it('rejects a declaration in a block that has closed', () => {
    const ts = ['function g() {', '  if (a) {', '    const tmp = 1', '  }', '  if (b) {', '    const tmp = 2', '  }', '}']
    expect(run(ts, 6, claim('shadows', 6, ts, ['tmp']))).toMatchObject({ verdict: 'unverified' })
  })

  it('accepts a top-level declaration below the cited line, and rejects a declaration in a block that closed at a deeper level', () => {
    const go = ['func f() {', '\tcount := 1', '\tuse(count)', '}', '', 'var count int']
    expect(run(go, 2, claim('shadows', 2, go, ['count']))).toMatchObject({ verdict: 'kept' })
    const ts = ['function g() {', '  if (a) {', '    const tmp = 1', '  }', '  if (b) {', '    if (c) {', '      const tmp = 2', '    }', '  }', '}']
    expect(run(ts, 7, claim('shadows', 7, ts, ['tmp']))).toMatchObject({ verdict: 'unverified' })
  })

  it('does not take an earlier declaration in the same block for an outer one', () => {
    const py = ['def f():', '    a = 1', '    a = 2']
    expect(run(py, 3, claim('shadows', 3, py, ['a']))).toMatchObject({ verdict: 'unverified' })
  })

  it('rejects a name the cited line does not declare', () => {
    const ts = ['function total(items: number[], count: number) {', '  for (const item of items) {', '    const count = item * 2', '    use(count)', '  }', '}']
    expect(run(ts, 4, claim('shadows', 4, ts, ['count']))).toMatchObject({ verdict: 'unverified' })
    expect(run(ts, 3, claim('shadows', 3, ts, []))).toMatchObject({ verdict: 'unverified' })
  })
})

describe('missing-comment: no comment line in the three lines above', () => {
  const py = ['# header', 'a = 1', 'b = 2', 'c = 3', 'd = 4']
  it('rejects a claim when a comment line is within three lines above', () => {
    expect(run(py, 4, claim('missing-comment', 4, py))).toMatchObject({ verdict: 'unverified' })
  })
  it('accepts it when the nearest comment is four lines above', () => {
    expect(run(py, 5, claim('missing-comment', 5, py))).toMatchObject({ verdict: 'kept', claimKind: 'missing-comment' })
  })
  it('counts // and /* comment lines as well', () => {
    const go = ['\t// explains', '\tx := 1', '\ty := 2']
    expect(run(go, 3, claim('missing-comment', 3, go))).toMatchObject({ verdict: 'unverified' })
  })
})

describe('type-mismatch: each compared type is defined in this file', () => {
  const ts = ['interface Meters { value: number }', 'interface Feet { value: number }', 'function toFeet(m: Meters): Feet {', '  return m as unknown as Feet', '}']
  it('accepts two types the file defines', () => {
    expect(run(ts, 4, claim('type-mismatch', 4, ts, ['Meters', 'Feet']))).toMatchObject({ verdict: 'kept', claimKind: 'type-mismatch' })
  })
  it('rejects a type the file never names', () => {
    expect(run(ts, 4, claim('type-mismatch', 4, ts, ['Meters', 'Gallons']))).toMatchObject({ verdict: 'unverified' })
  })
  it('rejects a mismatch between fewer than two types', () => {
    expect(run(ts, 4, claim('type-mismatch', 4, ts, ['Feet']))).toMatchObject({ verdict: 'unverified' })
  })
  it('rejects a type that is only imported, however it is parameterised', () => {
    const imp = ["import { Meters } from './units'", 'interface Feet { value: number }', 'const f = m as unknown as Feet', 'const g = n as unknown as Meters<string>']
    const s = run(imp, 4, claim('type-mismatch', 4, imp, ['Feet', 'Meters<string>']))
    expect(s.verdict).toBe('unverified')
    expect(s.reason).toMatch(/Meters/)
  })
})

describe('unused: the name is not used anywhere else in its scope', () => {
  const py = ['def f():', '    unused = compute()', '    used = compute()', '    return used', '', 'def g():', '    unused = 1', '    return unused']
  it('accepts a name that appears only at its declaration', () => {
    expect(run(py, 2, claim('unused', 2, py, ['unused']))).toMatchObject({ verdict: 'kept', claimKind: 'unused' })
  })
  it('rejects a name used again in the scope', () => {
    const s = run(py, 3, claim('unused', 3, py, ['used']))
    expect(s.verdict).toBe('unverified')
    expect(s.reason).toMatch(/line 4/)
  })
  it('does not count a use in another function', () => {
    expect(run(py, 2, claim('unused', 2, py, ['unused'])).verdict).toBe('kept')
  })
  it('for an import, looks at the whole file', () => {
    const imp = ['import os', 'import sys', '', 'def f():', '    return sys.argv']
    expect(run(imp, 1, claim('unused', 1, imp, ['os']))).toMatchObject({ verdict: 'kept' })
    expect(run(imp, 2, claim('unused', 2, imp, ['sys']))).toMatchObject({ verdict: 'unverified' })
  })
})

describe('null-risk: the variable is on the line, no guard comes before it, and the support shows a None', () => {
  const py = ['def f(items):', '    found = None', '    for i in items:', '        if i.ok:', '            found = i', '    return found.name']
  it('accepts an unguarded use whose support shows the None', () => {
    expect(run(py, 6, claim('null-risk', 6, py, ['found']), { support: 'found = None' })).toMatchObject({ verdict: 'kept', claimKind: 'null-risk' })
  })
  it('rejects it when a guard before the line leaves on None', () => {
    const guarded = [...py.slice(0, 5), '    if found is None:', '        return', py[5]]
    const s = run(guarded, 8, claim('null-risk', 8, guarded, ['found']), { support: 'found = None' })
    expect(s.verdict).toBe('unverified')
    expect(s.reason).toMatch(/guarded on line 6/)
  })
  it('rejects it when the support shows no None at all', () => {
    expect(run(py, 6, claim('null-risk', 6, py, ['found']), { support: 'for i in items:' })).toMatchObject({ verdict: 'unverified' })
  })
  it('rejects it when the support quoted is itself the guard', () => {
    const s = run(py, 6, claim('null-risk', 6, py, ['found']), { support: 'if found is None:' })
    expect(s.verdict).toBe('unverified')
    expect(s.reason).toMatch(/is itself a guard for found/)
  })
  it('rejects it when the variable is not on the cited line', () => {
    expect(run(py, 6, claim('null-risk', 6, py, ['items']), { support: 'found = None' })).toMatchObject({ verdict: 'unverified' })
  })
})

describe('the claim as the second pass sends it', () => {
  it('reads a well-formed claim and trims what is too long; a malformed one is null', () => {
    const read = (claim: unknown) => readVerdicts(JSON.stringify({ verdicts: [{ id: 1, verdict: 'keep', line: 1, evidence: 'x', support: 'x', reason: 'r', claim }] }))?.get(1)?.claim
    expect(read({ kind: 'unused', names: [' a ', 3, '', 'b'], lines: [4, 2.5, 'x', 7], quote: 'q' })).toEqual({ kind: 'unused', names: ['a', 'b'], lines: [4, 7], quote: 'q' })
    expect(read({ kind: 'unused', names: 'a', quote: 'q' })).toEqual({ kind: 'unused', names: [], lines: [], quote: 'q' })
    for (const bad of [null, undefined, 'unused', [], { kind: 'unused' }, { kind: 'bogus', quote: 'q' }, { kind: 7, quote: 'q' }]) expect(read(bad)).toBeNull()
  })

  it('is asked for in the prompt, with every kind the code can check', () => {
    const prompt = buildVerifyPrompt('file', 10)
    for (const kind of ['shadows', 'missing-comment', 'type-mismatch', 'unused', 'null-risk', 'other']) expect(prompt).toContain(`"${kind}"`)
    expect(prompt).toContain('"claim":')
  })
})

describe('a pull request quote may carry the diff sign it was read with', () => {
  const doc = diffDoc([
    { text: '=== a.py (modified)', kind: 'meta', file: 'a.py' },
    { text: 'x = compute()', kind: 'add', file: 'a.py' },
  ])
  const c: Candidate = { id: 1, line: 2, fromLine: 2, quote: 'x = compute()', severity: 'info', message: 'Look at this line.', suggestion: 'Change this line.', moveNote: null, loweredFrom: null }
  const settled = (quote: string) =>
    settle(c, readVerdicts(JSON.stringify({ verdicts: [{ id: 1, verdict: 'keep', line: 2, evidence: 'x = compute()', support: 'x = compute()', reason: 'r', claim: { kind: 'other', names: [], lines: [2], quote } }] }))?.get(1), doc)
  it('confirms the quote with or without the sign, and still refuses a different one', () => {
    expect(settled('+x = compute()')).toMatchObject({ verdict: 'kept' })
    expect(settled('+ x = compute()')).toMatchObject({ verdict: 'kept' })
    expect(settled('x = compute()')).toMatchObject({ verdict: 'kept' })
    expect(settled('+x = compute(1)')).toMatchObject({ verdict: 'unverified' })
  })
})
