import { describe, expect, it } from 'vitest'
import * as models from '../../netlify/shared/models'
import { CHECK, EXTRACT, EXTRACT_CONCURRENCY, MIN_RETRY_BUDGET_MS, MODEL, RETRY_PAUSE_MS, SYNTH } from '../../netlify/shared/models'
import { CALL_TIMEOUT_MS } from '../../netlify/shared/openrouter'
import { RUN_BUDGET_MS } from '../../netlify/shared/pipeline'

describe('role settings', () => {
  it('requests one model alias for extract, check and synthesis, and names no served model or price of its own', () => {
    expect(MODEL).toBe('~anthropic/claude-haiku-latest')
    expect([EXTRACT.model, CHECK.model, SYNTH.model]).toEqual([MODEL, MODEL, MODEL])
    expect(Object.keys(models).sort()).not.toContain('PRICES')
    expect(Object.keys(models).sort()).not.toContain('SERVED_MODEL')
  })

  it('differs between roles only by output cap, JSON mode and require_parameters, and every role turns reasoning off', () => {
    const off = { enabled: false }
    expect(EXTRACT).toEqual({ model: MODEL, maxTokens: 800, jsonMode: false, reasoning: off })
    expect(CHECK).toEqual({ model: MODEL, maxTokens: 300, jsonMode: true, reasoning: off })
    expect(SYNTH).toEqual({ model: MODEL, maxTokens: 1_500, jsonMode: true, reasoning: off, requireParameters: true })
  })

  it('gives every role a different output cap, which the scripted tests use to tell the roles apart', () => {
    expect(new Set([EXTRACT.maxTokens, CHECK.maxTokens, SYNTH.maxTokens]).size).toBe(3)
  })

  it.each([
    ['extract', EXTRACT],
    ['check', CHECK],
    ['synthesis', SYNTH],
  ])('%s sets no temperature', (_name, role) => {
    expect(role).not.toHaveProperty('temperature')
  })
})

describe('time limits', () => {
  it('ends the run at 23 s, well inside the roughly 30 s cut-off seen on the live site', () => {
    expect(RUN_BUDGET_MS).toBe(23_000)
    expect(RUN_BUDGET_MS).toBeLessThan(30_000)
  })

  it('runs every chunk at once, since the concurrency equals the 12 chunk cap, and pauses 0.5 s before a retry', () => {
    expect(EXTRACT_CONCURRENCY).toBe(12)
    expect(RETRY_PAUSE_MS).toBe(500)
  })

  it('gives the synthesis call 1500 output tokens, above the 875 to 1,082 it used live, with one of ten calls hitting 1200', () => {
    expect(SYNTH.maxTokens).toBe(1_500)
  })

  it('times a model call out after 10 s, inside the run budget', () => {
    expect(CALL_TIMEOUT_MS).toBe(10_000)
    expect(CALL_TIMEOUT_MS).toBeLessThan(RUN_BUDGET_MS)
  })

  it('starts a retry only with at least 11 s of the budget left', () => {
    expect(MIN_RETRY_BUDGET_MS).toBe(11_000)
    expect(MIN_RETRY_BUDGET_MS).toBeLessThan(RUN_BUDGET_MS)
  })
})
