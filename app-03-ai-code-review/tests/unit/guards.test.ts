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

describe('a guard answers a claim that a value may be unset', () => {
  it('finds the guard before the real res.jsonp line', () => {
    const g = guardFor('body', JSONP, L348)
    expect(g?.line).toBe(9)
    expect(guardedClaim('body', JSONP, L348)).toMatch(/^Not confirmed: body is already guarded on line 9/)
  })
  it('treats the guard itself as self-refuting support', () => {
    expect(supportHandlesCondition('body', 'if (body === undefined) {')).toMatch(/is itself a guard for body/)
    expect(supportHandlesCondition('body', "body = ''")).toBeNull()
  })
  it('finds one-line fallbacks and early returns', () => {
    expect(guardFor('opts', ['opts = opts || {}', 'x', 'use(opts)'], 3)?.line).toBe(1)
    expect(guardFor('val', ['def f(val):', '    if val is None:', '        return', '    use(val)'], 4)?.line).toBe(2)
    expect(guardFor('val', ['def f(val):', '    if not val:', '        raise ValueError', '    use(val)'], 4)?.line).toBe(2)
  })
  it('does not fire without a guard or on another variable', () => {
    expect(guardFor('body', JSONP.map((l) => l.replace('body === undefined', 'other === undefined')), L348)).toBeNull()
    expect(guardFor('body', ['    if (body === undefined) {', '      log()', '    }', '    use(body)'], 4)).toBeNull()
    expect(guardFor('callback', JSONP, L348)).toBeNull()
    expect(guardFor('val', ['def f(val):', '    use(val)'], 2)).toBeNull()
  })
  it('looks only before the cited line: a guard after it does not answer the claim', () => {
    const send = ['    this.statusCode = chunk;', '    chunk = statuses.message[chunk]', '  }', '', '  var len', '  if (chunk !== undefined) {', '    len = Buffer.byteLength(chunk, encoding)']
    expect(guardFor('chunk', send, 2)).toBeNull()
  })
})
