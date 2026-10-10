import { describe, expect, it } from 'vitest'
import { fileDoc } from '../../netlify/shared/anchor'
import { importedNames } from '../../netlify/shared/claims'
import { claimVariables, flowsIntoExternal, isMutationClaim, provenanceOf, traceOrigin } from '../../netlify/shared/provenance'
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

describe('imports anywhere in the file, and what an imported call does with a value', () => {
  // click 8.1.7 utils.py: glob is imported inside the function (line 603), the claim is about line 616.
  const GLOB = ['import os', 'import re', '', 'def _expand_args(args, glob_recursive=True):', '    from glob import glob', '', '    out = []', '    for arg in args:', '        try:', '            matches = glob(arg, recursive=glob_recursive)', '        except re.error:', '            matches = []', '    return out']

  it('finds an import inside a function, so glob counts as imported', () => {
    expect([...importedNames(GLOB)]).toEqual(expect.arrayContaining(['glob']))
  })

  it('does not confirm the live click claim that glob can raise OSError (utils.py L616)', async () => {
    const { unconfirmable } = await import('../../netlify/shared/claims')
    const message = 'The re.error handler only catches regex-related errors, but glob can also raise other exceptions such as OSError on certain filesystem errors, which would propagate unexpectedly.'
    expect(unconfirmable(message, 'except re.error:', importedNames(GLOB))).toBe('Not confirmed: the claim rests on how glob behaves, and glob is not defined in this file.')
  })

  // express 4.21.2 response.js lines 877 to 891, copied verbatim (the cookie import is line 31 there).
  const COOKIE = [
    "var cookie = require('cookie');",
    'res.cookie = function (name, value, options) {',
    '  if (opts.maxAge != null) {',
    '    var maxAge = opts.maxAge - 0',
    '',
    '    if (!isNaN(maxAge)) {',
    '      opts.expires = new Date(Date.now() + maxAge)',
    '      opts.maxAge = Math.floor(maxAge / 1000)',
    '    }',
    '  }',
    '',
    "  this.append('Set-Cookie', cookie.serialize(name, String(val), opts));",
    '};',
  ]
  const maxAgeLine = COOKIE.findIndex((l) => l.includes('var maxAge')) + 1

  it('does not confirm the live express claim whose reason says opts is passed on to cookie.serialize (response.js L879)', async () => {
    const { unconfirmable } = await import('../../netlify/shared/claims')
    const { flowsIntoExternal } = await import('../../netlify/shared/provenance')
    const reason = 'opts.maxAge is passed on unchanged to cookie.serialize when it is non-numeric, so the cookie is set without the intended expiry.'
    const imports = importedNames(COOKIE)
    expect(unconfirmable(reason, COOKIE[maxAgeLine - 1], imports)).toBe('Not confirmed: the claim rests on how cookie behaves, and cookie is not defined in this file.')
    expect(flowsIntoExternal('If opts.maxAge is non-numeric the value is passed on to the cookie header.', COOKIE, maxAgeLine, imports)).toMatch(/^Not confirmed: opts is passed to cookie on line 12/)
  })

  it('leaves alone a consequence inside the file\'s own code, and a claim with no hand-off', () => {
    const local = ['function build(opts) { return opts }', 'function run(opts) {', '  var maxAge = opts.maxAge - 0', '  return build(opts)', '}']
    expect(flowsIntoExternal('The value is passed on to the builder later.', local, 3, new Set())).toBeNull()
    expect(flowsIntoExternal('The loop is slow.', COOKIE, maxAgeLine, importedNames(COOKIE))).toBeNull()
  })
})
