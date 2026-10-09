import { describe, expect, it } from 'vitest'
import { fileDoc } from '../../netlify/shared/anchor'
import { importedNames } from '../../netlify/shared/claims'
import { claimVariables, isMutationClaim, provenanceOf, traceOrigin } from '../../netlify/shared/provenance'
import { provenanceLines, scopeListing } from '../../netlify/shared/scope'
import { settle, type RawVerdict } from '../../netlify/shared/verify'
import type { Candidate } from '../../netlify/shared/review'

// axios v1.7.7 lib/core/Axios.js: the import and lines 75 to 77 and 107 to 113, copied verbatim (padding keeps the numbers apart).
const AXIOS = [
  "import mergeConfig from './mergeConfig.js';",
  'class Axios {',
  '  _request(configOrUrl, config) {',
  '    config = mergeConfig(this.defaults, config);',
  '',
  '    const {transitional, paramsSerializer, headers} = config;',
  '',
  '    config.method = (config.method || this.defaults.method || "get").toLowerCase();',
  '    headers && utils.forEach(',
  "      ['delete', 'get', 'head', 'post', 'put', 'patch', 'common'],",
  '      (method) => {',
  '        delete headers[method];',
  '      }',
  '    );',
  '  }',
  '}',
]
const CITED = AXIOS.findIndex((l) => l.includes('delete headers[method]')) + 1
const MESSAGE = "The loop deletes keys from the headers object that was passed in by the caller, mutating the caller's object."

describe('traceOrigin and provenanceOf', () => {
  it('follows headers back through the destructuring to config, assigned from the imported mergeConfig()', () => {
    const trace = traceOrigin(AXIOS, 'headers', CITED)
    expect(trace.lines).toEqual([6, 4])
    expect(trace.origin).toEqual({ kind: 'call', callee: 'mergeConfig', line: 4, defined: false })
  })

  it('does not confirm the live axios L112 claim: headers is not the caller\'s object', () => {
    const p = provenanceOf(MESSAGE, AXIOS, CITED, importedNames(AXIOS))
    expect(p.block).toBe('Not confirmed: headers is assigned from mergeConfig() on line 4, an imported function, so it may not be the caller\'s object.')
    expect(p.lines).toEqual(expect.arrayContaining([4, 6]))
  })

  it('treats a value that is a parameter as the caller\'s, and a literal as nobody\'s', () => {
    const param = ['function f(headers) {', '  delete headers.a', '}']
    expect(provenanceOf(MESSAGE, param, 2, new Set()).block).toBeNull()
    expect(traceOrigin(['const headers = {}', 'delete headers.a'], 'headers', 2).origin).toEqual({ kind: 'literal' })
  })

  it('shows the definition of a local function the value came from, instead of blocking', () => {
    const local = ['function build(cfg) {', '  return cfg', '}', 'function run(input) {', '  const headers = build(input)', '  delete headers.a', '}']
    const p = provenanceOf(MESSAGE, local, 6, new Set())
    expect(p.block).toBeNull()
    expect(p.localCalls).toEqual(['build'])
  })

  it('only looks at claims about the caller\'s or input object, and finds the variables the line and claim share', () => {
    expect(isMutationClaim(MESSAGE)).toBe(true)
    expect(isMutationClaim('The loop allocates on every call.')).toBe(false)
    expect(provenanceOf('The loop is slow.', AXIOS, CITED, importedNames(AXIOS)).block).toBeNull()
    expect(claimVariables(MESSAGE, '        delete headers[method];')).toEqual(['headers'])
  })
})

describe('a cut scope keeps the lines its variables came from', () => {
  it('lists the assignment of headers and config above a long function that was cut around line 112', () => {
    const body = Array.from({ length: 120 }, (_, i) => `    step${i + 1}()`)
    const code = ['  _request(configOrUrl, config) {', '    config = mergeConfig(this.defaults, config);', '    const {transitional, headers} = config;', ...body, '    delete headers[method];', ...body.slice(0, 5), '  }']
    const at = code.findIndex((l) => l.includes('delete headers')) + 1
    expect(provenanceLines(code, at, MESSAGE)).toEqual([2, 3])
    const listing = scopeListing(code, code, at, MESSAGE).split('\n')
    expect(listing).toContain('2\t|     config = mergeConfig(this.defaults, config);')
    expect(listing).toContain('3\t|     const {transitional, headers} = config;')
    expect(listing).toContain(`${at}\t|     delete headers[method];`)
  })
})

describe('a warning needs its code inside what the reads were shown', () => {
  const code = ['var RegexpCompileFunc = regexp.Compile', ...Array.from({ length: 80 }, (_, i) => `// filler ${i}`), 'func build() {', '\tx := RegexpCompileFunc(p)', '}']
  const doc = fileDoc(code)
  const line = code.findIndex((l) => l.includes('x := RegexpCompileFunc')) + 1
  const candidate = (severity: Candidate['severity']): Candidate => ({ id: 1, line, fromLine: line, quote: '', severity, message: 'The compile hook is read on every call.', suggestion: 'Guard it.', moveNote: null, loweredFrom: null })
  const verdict = (support: string): RawVerdict => ({ id: 1, verdict: 'keep', line, evidence: 'x := RegexpCompileFunc(p)', support, reason: 'It is read each call.' })

  it('confirms an info comment whatever the distance, and a warning whose support is in the scope', () => {
    expect(settle(candidate('info'), verdict('var RegexpCompileFunc = regexp.Compile'), doc).verdict).toBe('kept')
    expect(settle(candidate('warning'), verdict('x := RegexpCompileFunc(p)'), doc).verdict).toBe('kept')
  })

  it('does not confirm a warning whose support sits outside the scope, the lines its variables came from and the definitions it names', () => {
    const far = ['// config line', ...code.slice(1)]
    const s = settle(candidate('warning'), verdict('// config line'), fileDoc(far))
    expect(s.verdict).toBe('unverified')
    expect(s.reason).toMatch(/is outside the code the reads were shown/)
  })
})

describe('the reason is held to the same rule as the message', () => {
  it('caps a comment whose reason names how an imported function behaves (axios run 3: "after mergeConfig when it shares references")', () => {
    const doc = fileDoc(AXIOS)
    const candidate: Candidate = { id: 1, line: 2, fromLine: 2, quote: '', severity: 'info', message: 'The class has no constructor guard.', suggestion: 'Add one.', moveNote: null, loweredFrom: null }
    const raw: RawVerdict = { id: 1, verdict: 'keep', line: 2, evidence: 'class Axios {', support: 'class Axios {', reason: 'The class shares references after mergeConfig returns, so a guard is needed.' }
    expect(settle(candidate, raw, doc).reason).toBe('Not confirmed: the claim rests on how mergeConfig behaves, and mergeConfig is not defined in this file.')
  })
})
