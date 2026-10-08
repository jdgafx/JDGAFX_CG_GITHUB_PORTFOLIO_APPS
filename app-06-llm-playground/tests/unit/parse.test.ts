import { describe, expect, it } from 'vitest'
import { errorName, isRecord, numOrNull, perToken, strOrNull } from '../../netlify/shared/parse'

describe('perToken', () => {
  it('reads a price string as USD per token', () => {
    expect(perToken('0.0000002')).toBe(2e-7)
    expect(perToken('0')).toBe(0)
    expect(perToken(0.000001)).toBe(0.000001)
  })

  it('treats a missing, empty, negative or non-numeric price as unknown', () => {
    expect(perToken(undefined)).toBeNull()
    expect(perToken('')).toBeNull()
    // OpenRouter sends -1 for prices that change per request.
    expect(perToken('-1')).toBeNull()
    expect(perToken('free')).toBeNull()
    expect(perToken(true)).toBeNull()
  })
})

describe('JSON value readers', () => {
  it('tells an object from an array and null', () => {
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord([1])).toBe(false)
    expect(isRecord(null)).toBe(false)
  })

  it('keeps only finite numbers and plain strings', () => {
    expect(numOrNull(3)).toBe(3)
    expect(numOrNull('3')).toBeNull()
    expect(numOrNull(NaN)).toBeNull()
    expect(strOrNull('READY')).toBe('READY')
    expect(strOrNull(5)).toBeNull()
  })

  it('names an error, or falls back when the value is not an error', () => {
    expect(errorName(new DOMException('late', 'TimeoutError'))).toBe('TimeoutError')
    expect(errorName('boom')).toBe('UnknownError')
  })
})
