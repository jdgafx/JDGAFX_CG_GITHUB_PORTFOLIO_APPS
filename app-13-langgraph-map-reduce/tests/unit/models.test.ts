import { describe, expect, it } from 'vitest'
import * as models from '../../netlify/shared/models'
import {
  CHECK,
  CHECK_CALL_TIMEOUT_MS,
  EXTRACT,
  EXTRACT_CALL_TIMEOUT_MS,
  EXTRACT_CONCURRENCY,
  MIN_RESYNTH_BUDGET_MS,
  MIN_RETRY_BUDGET_MS,
  MODEL,
  RETRY_CALL_TIMEOUT_MS,
  RETRY_PAUSE_MS,
  SYNTH,
 } from '../../netlify/shared/models'
import { CALL_TIMEOUT_MS } from '../../netlify/shared/openrouter'
import { RUN_BUDGET_MS } from '../../netlify/shared/pipeline'

describe('role settings', () => {
  it('requests one model alias for extract, check and synthesis, and names no served model or price of its own', () => {
    expect(MODEL).toBe('~anthropic/claude-haiku-latest')
    expect([EXTRACT.model, CHECK.model, SYNTH.model]).toEqual([MODEL, MODEL, MODEL])
    expect(Object.keys(models).sort()).not.toContain('PRICES')
    expect(Object.keys(models).sort()).not.toContain('SERVED_MODEL')
  })

  it('differs between roles only by output cap, JSON mode and require_parameters, and no role sets a reasoning option', () => {
    expect(EXTRACT).toEqual({ model: MODEL, maxTokens: 2_500, jsonMode: false })
    expect(CHECK).toEqual({ model: MODEL, maxTokens: 2_000, jsonMode: true })
    expect(SYNTH).toEqual({ model: MODEL, maxTokens: 3_500, jsonMode: true, requireParameters: true })
    for (const role of [EXTRACT, CHECK, SYNTH]) expect(role).not.toHaveProperty('reasoning')
  })

  it('leaves each cap room for about 500 thinking tokens above the largest live answer', () => {
    expect(EXTRACT.maxTokens).toBeGreaterThanOrEqual(495 + 500 + 1_000)
    expect(SYNTH.maxTokens).toBeGreaterThanOrEqual(1_209 + 500 + 1_000)
    expect(CHECK.maxTokens).toBeGreaterThanOrEqual(12 + 500 + 1_000)
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

  it('times a model call out after 12 s, inside the run budget', () => {
    expect(CALL_TIMEOUT_MS).toBe(12_000)
    expect(CALL_TIMEOUT_MS).toBeLessThan(RUN_BUDGET_MS)
  })

  it('starts a retry only with at least 17 s of the budget left: pause, a retry extract call, a second synthesis and check, and 1 s of margin', () => {
    expect(MIN_RETRY_BUDGET_MS).toBe(17_000)
    expect(MIN_RETRY_BUDGET_MS).toBeLessThan(RUN_BUDGET_MS)
    expect(MIN_RETRY_BUDGET_MS).toBeGreaterThanOrEqual(RETRY_PAUSE_MS + 5_500 + MIN_RESYNTH_BUDGET_MS + 1_000)
  })

  it('keeps every per-call limit under the run budget, and the first-pass extract limit under the synthesis limit', () => {
    for (const limit of [EXTRACT_CALL_TIMEOUT_MS, RETRY_CALL_TIMEOUT_MS, CHECK_CALL_TIMEOUT_MS]) expect(limit).toBeLessThan(CALL_TIMEOUT_MS)
    expect(EXTRACT_CALL_TIMEOUT_MS + CALL_TIMEOUT_MS + CHECK_CALL_TIMEOUT_MS).toBeGreaterThan(RUN_BUDGET_MS)
  })
})
