import { describe, expect, it } from 'vitest'
import { isCutOff } from '../../src/lib/finish'

describe('isCutOff is an allowlist: only stop and end_turn are a finished reply', () => {
  it.each(['stop', 'end_turn'])('%s is finished', finish => {
    expect(isCutOff(finish)).toBe(false)
  })

  it.each(['length', 'timeout', 'error', 'interrupted', 'content_filter', 'tool_calls', 'max_tokens', 'refusal', 'something_new', '', null])('%s is not finished', finish => {
    expect(isCutOff(finish)).toBe(true)
  })
})
