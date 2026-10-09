import { describe, expect, it } from 'vitest'
import { halfWindow, isValidPackageName, MAX_PACKAGES } from '../../netlify/shared/contract'

describe('isValidPackageName', () => {
  it('accepts plain, dotted, dashed and scoped names', () => {
    for (const name of ['react', 'a', 'chart.js', 'lodash.debounce', 'drizzle-orm', 'left_pad', '@angular/core', '@types/node', '@tanstack/react-query', '@a/b']) {
      expect(isValidPackageName(name), name).toBe(true)
    }
  })

  it('rejects uppercase, spaces, leading dot or underscore, and URL-unsafe characters', () => {
    for (const name of ['', 'React', 'a b', '.hidden', '_private', 'foo@1.2.3', 'a/b', 'https://x.test', '../etc', 'a?b', 'a#b', 'a%20b']) {
      expect(isValidPackageName(name), name).toBe(false)
    }
  })

  it('rejects malformed scopes', () => {
    for (const name of ['@scope', '@/pkg', '@scope/', '@a/b/c', '@@a/b', '@Scope/pkg', '@scope/.pkg']) {
      expect(isValidPackageName(name), name).toBe(false)
    }
  })

  it('allows 214 characters and rejects 215', () => {
    expect(isValidPackageName('a'.repeat(214))).toBe(true)
    expect(isValidPackageName('a'.repeat(215))).toBe(false)
  })
})

describe('contract constants', () => {
  it('compares at most five packages', () => {
    expect(MAX_PACKAGES).toBe(5)
  })

  it('halves a window, dropping the odd day', () => {
    expect(halfWindow(30)).toBe(15)
    expect(halfWindow(365)).toBe(182)
    expect(halfWindow(1)).toBe(0)
  })
})
