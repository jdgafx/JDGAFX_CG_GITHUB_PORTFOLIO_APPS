import { describe, expect, it } from 'vitest'
import { guardedClaim, guardFor, supportHandlesCondition } from '../../netlify/shared/guards'

// Express res.jsonp, the live lines 329-348 (verify-03t, L348).
const JSONP = [
  '  // jsonp',
  "  if (typeof callback === 'string' && callback.length !== 0) {",
  "    this.set('X-Content-Type-Options', 'nosniff');",
  "    this.set('Content-Type', 'text/javascript');",
  '',
  '    // restrict callback charset',
  "    callback = callback.replace(/[^\\[\\]\\w$.]/g, '');",
  '',
  '    if (body === undefined) {',
  '      // empty argument',
  "      body = ''",
  "    } else if (typeof body === 'string') {",
  '      // replace chars not allowed in JavaScript that are in JSON',
  '      body = body',
  '    }',
  '',
  "    body = '/**/ typeof ' + callback + ' === \\'function\\' && ' + callback + '(' + body + ');';",
]
const L348 = JSONP.length
const MESSAGE = "If body is undefined the output becomes the literal string 'undefined'."

describe('a guard answers a claim that a value may be unset', () => {
  it('finds the guard before the real res.jsonp line', () => {
    const g = guardFor(MESSAGE, JSONP, L348)
    expect(g?.line).toBe(9)
    expect(guardedClaim(MESSAGE, JSONP, L348)).toMatch(/^Not confirmed: body is already guarded on line 9/)
  })
  it('treats the guard itself as self-refuting support', () => {
    expect(supportHandlesCondition(MESSAGE, JSONP[L348 - 1], 'if (body === undefined) {')).toMatch(/is itself a guard for body/)
    expect(supportHandlesCondition(MESSAGE, JSONP[L348 - 1], "body = ''")).toBeNull()
  })
  it('finds one-line fallbacks and early returns', () => {
    expect(guardFor('opts may be undefined here', ['opts = opts || {}', 'x', 'use(opts)'], 3)?.line).toBe(1)
    expect(guardFor('val may be None', ['def f(val):', '    if val is None:', '        return', '    use(val)'], 4)?.line).toBe(2)
    expect(guardFor('val may be None', ['def f(val):', '    if not val:', '        raise ValueError', '    use(val)'], 4)?.line).toBe(2)
  })
  it('does not fire without a guard, on another variable, or on a claim that is not about an unset value', () => {
    expect(guardFor(MESSAGE, JSONP.map((l) => l.replace('body === undefined', 'other === undefined')), L348)).toBeNull()
    expect(guardFor(MESSAGE, ['    if (body === undefined) {', '      log()', '    }', '    use(body)'], 4)).toBeNull()
    expect(guardFor('body is sent twice', JSONP, L348)).toBeNull()
    expect(guardFor('val may be None', ['def f(val):', '    use(val)'], 2)).toBeNull()
  })
})

describe('only a claim that the value is unset is answered', () => {
  it('leaves the live click utils.py L330 claim (bytes, not None) alone', () => {
    const texts = ['    if not out:', '        return', '', '    file.write(out)  # type: ignore']
    expect(guardFor('The type: ignore suppresses a real mismatch: out may be bytes here and writing bytes to a text stream raises TypeError.', texts, 4)).toBeNull()
    expect(guardFor('out may be None here', texts, 4)?.line).toBe(1)
  })
})
