import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileDoc } from '../../netlify/shared/anchor'
import type { Candidate } from '../../netlify/shared/review'
import { assemble } from './assemble-helper'
import { readVerdicts } from '../../netlify/shared/verify'

// The three false or inconsistent claims of the 2026-10-11 SP2 run (app-03-ai-code-review-sp2-2026-10-11), replayed from the
// saved file text at the pinned tag and the second pass's captured answer. The second pass now types each claim; the code
// checks that type against the file, so a claim the file does not bear out is Not confirmed, never shown as verified.
const source = (name: string): string[] => readFileSync(new URL(`../fixtures/sp2/${name}`, import.meta.url), 'utf8').replace(/\n$/, '').split('\n')
const MUX = fileDoc(source('gorilla-mux-v1.8.1-mux.go.txt'))
const AUTH = fileDoc(source('requests-auth.py.txt'))
const REDUX = fileDoc(source('redux-v5.0.1-createStore.ts.txt'))

const candidate = (over: Partial<Candidate>): Candidate => ({ id: 1, line: 1, fromLine: 1, quote: '', severity: 'info', message: '', suggestion: '', moveNote: null, loweredFrom: null, ...over })

interface Item {
  verdict?: string
  line: number
  evidence: string
  support: string
  reason: string
  claim?: unknown
}

/** The comment as the page shows it after both reads: the first read's answer is `item`; the adversary finds nothing. */
function shown(doc: ReturnType<typeof fileDoc>, c: Candidate, item: Item) {
  const first = readVerdicts(JSON.stringify({ verdicts: [{ id: c.id, verdict: 'keep', ...item }] }))
  const adversary = readVerdicts(JSON.stringify({ verdicts: [{ id: c.id, verdict: 'stands', line: item.line, evidence: item.evidence, support: '', reason: 'Nothing breaks it.' }] }))
  const [comment] = assemble([c], [], [first, adversary], doc, (n) => ({ text: doc.texts[n - 1], where: null }))
  return comment
}

const URL_SHADOW = {
  message: 'The local variable url shadows the conventional net/url package name and copies the whole URL struct just to change Path.',
  suggestion: 'Rename to u or redirectURL for clarity.',
}
const urlItem = (claim: unknown): Item => ({
  line: 187,
  evidence: 'url := *req.URL',
  support: 'url.Path = p',
  reason: 'The local variable url shadows the conventional net/url name, and the code copies the whole URL struct only to set Path, so a rename is a concrete improvement.',
  claim,
})

describe('the live false claims of the SP2 run are not confirmed', () => {
  it('mux.go L187: url shadows nothing, because net/url is not imported and no outer url exists', () => {
    const c = candidate({ line: 187, fromLine: 187, quote: 'url := *req.URL', ...URL_SHADOW })
    const out = shown(MUX, c, urlItem({ kind: 'shadows', names: ['url'], lines: [187], quote: 'url := *req.URL' }))
    expect(out).toMatchObject({ verdict: 'unverified', decidedBy: 'none' })
    expect(out.reason).toMatch(/url/)
    expect(out.reason).toMatch(/imported|declared/)
  })

  it('auth.py L267: the comment explaining the bare r.content is on the two lines above', () => {
    const c = candidate({
      line: 267,
      fromLine: 267,
      quote: 'r.content',
      message: 'Accessing r.content as a bare expression relies on its side effect of reading the body, which is not obvious to readers.',
      suggestion: 'Assign it to a variable or call r.content explicitly with a comment.',
    })
    const out = shown(AUTH, c, {
      line: 267,
      evidence: 'r.content',
      support: 'r.content',
      reason: 'A bare r.content expression statement exists at line 267 with no comment explaining its side effect of reading the body.',
      claim: { kind: 'missing-comment', names: [], lines: [267], quote: 'r.content' },
    })
    expect(out).toMatchObject({ verdict: 'unverified', decidedBy: 'none' })
    expect(out.reason).toMatch(/comment/)
    expect(out.reason).toMatch(/265|266/)
  })

  it('redux createStore.ts L330: a mismatch between Reducer types needs Reducer, which only ./types/reducers defines', () => {
    const c = candidate({
      line: 330,
      fromLine: 330,
      quote: 'nextReducer as unknown as Reducer<S, A, PreloadedState>',
      message: 'A double type assertion through unknown is used to force the reducer type, which hides a real type mismatch between Reducer<S, A> and Reducer<S, A, PreloadedState>.',
      suggestion: 'Make replaceReducer generic over PreloadedState so no cast is needed.',
    })
    const out = shown(REDUX, c, {
      line: 330,
      evidence: 'currentReducer = nextReducer as unknown as Reducer<S, A, PreloadedState>',
      support: 'function replaceReducer(nextReducer: Reducer<S, A>): void {',
      reason: 'The parameter is typed Reducer<S, A> and cast through unknown to Reducer<S, A, PreloadedState>, which the code shows is a real type mismatch.',
      claim: { kind: 'type-mismatch', names: ['Reducer<S, A>', 'Reducer<S, A, PreloadedState>'], lines: [330], quote: 'nextReducer as unknown as Reducer<S, A, PreloadedState>' },
    })
    expect(out).toMatchObject({ verdict: 'unverified', decidedBy: 'none' })
    expect(out.reason).toMatch(/Reducer/)
    expect(out.reason).toMatch(/another file|not defined in this file/)
  })
})

describe('true claims from the same files stay kept', () => {
  it('mux.go L177: path shadows the imported path package', () => {
    const c = candidate({
      line: 177,
      fromLine: 177,
      severity: 'warning',
      quote: 'path := req.URL.Path',
      message: 'The local variable path shadows the imported path package within this function scope, which hurts readability.',
      suggestion: 'Rename the local variable to something like reqPath.',
    })
    const out = shown(MUX, c, {
      line: 177,
      evidence: 'path := req.URL.Path',
      support: 'p := cleanPath(path); p != path {',
      reason: 'The local variable path shadows the imported path package in ServeHTTP.',
      claim: { kind: 'shadows', names: ['path'], lines: [177], quote: 'path := req.URL.Path' },
    })
    expect(out).toMatchObject({ verdict: 'kept', decidedBy: 'verifier', line: 177, claimKind: 'shadows' })
  })

  it('mux.go L527: err shadows the err declared in the enclosing function', () => {
    const c = candidate({
      line: 527,
      fromLine: 527,
      severity: 'warning',
      quote: 'regex, err := regexp.Compile(pairs[i+1])',
      message: 'The err declared here shadows the err from the enclosing function scope, which is a common source of subtle bugs in Go.',
      suggestion: 'Reuse the outer err or rename the inner variable.',
    })
    const out = shown(MUX, c, {
      line: 527,
      evidence: 'regex, err := regexp.Compile(pairs[i+1])',
      support: 'length, err := checkPairs(pairs...)',
      reason: 'The := inside the loop declares a new err that shadows the outer err from line 521.',
      claim: { kind: 'shadows', names: ['err'], lines: [527], quote: 'regex, err := regexp.Compile(pairs[i+1])' },
    })
    expect(out).toMatchObject({ verdict: 'kept', decidedBy: 'verifier', line: 527, claimKind: 'shadows' })
  })

  it('auth.py L262: a missing comment is confirmed on a line with no comment in the three lines above it', () => {
    const at = 262
    expect(AUTH.texts[at - 1].trim()).toBe('pat = re.compile(r"digest ", flags=re.IGNORECASE)')
    const c = candidate({ line: at, fromLine: at, quote: 'pat = re.compile(', message: 'The digest pattern is compiled with no comment saying why the match is case-insensitive.', suggestion: 'Add a comment above the compile call.' })
    const out = shown(AUTH, c, {
      line: at,
      evidence: 'pat = re.compile(r"digest ", flags=re.IGNORECASE)',
      support: 'pat = re.compile(r"digest ", flags=re.IGNORECASE)',
      reason: 'No comment sits above the compile call.',
      claim: { kind: 'missing-comment', names: [], lines: [at], quote: 'pat = re.compile(r"digest ", flags=re.IGNORECASE)' },
    })
    expect(out).toMatchObject({ verdict: 'kept', claimKind: 'missing-comment' })
  })
})
