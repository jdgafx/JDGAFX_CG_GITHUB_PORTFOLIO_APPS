import { describe, expect, it } from 'vitest'
import { isPackageName } from '../../shared/packageName'

describe('isPackageName: the one rule both sides use', () => {
  it('accepts lower-case npm names, scoped or not', () => {
    for (const ok of ['react', 'drizzle-orm', '@anthropic-ai/sdk', 'd3', 'lodash.merge', 'a~b', 'constructor']) expect(isPackageName(ok), ok).toBe(true)
  })
  it('refuses a leading ~ or -, upper case, spaces, a bare scope, paths and a name over 214 characters', () => {
    const bad = ['', ' ', '~x', '-x', '.x', '_x', '@~s/x', '@-s/x', '@s/~x', '@s/-x', 'UPPER', 'React', '@Scope/pkg', 'Has Space', 'a/b', '../x', '@scope', 'x'.repeat(215), 'a?b', 'a\nb']
    for (const name of bad) expect(isPackageName(name), JSON.stringify(name)).toBe(false)
  })
  it('refuses anything that is not a string', () => {
    for (const v of [null, undefined, 5, {}, ['react']]) expect(isPackageName(v)).toBe(false)
  })
})
