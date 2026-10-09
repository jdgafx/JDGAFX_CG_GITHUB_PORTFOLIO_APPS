import { describe, expect, it } from 'vitest'
import { CHECK, EXTRACT, EXTRACT_CONCURRENCY, MIN_RETRY_BUDGET_MS, PRICES, RETRY_PAUSE_MS, SYNTH } from '../../netlify/shared/models'
import { CALL_TIMEOUT_MS } from '../../netlify/shared/openrouter'
import { RUN_BUDGET_MS } from '../../netlify/shared/pipeline'

describe('role settings', () => {
  it.each([
    ['extract', EXTRACT],
    ['check', CHECK],
    ['synthesis', SYNTH],
  ])('%s never sets a temperature together with require_parameters', (_name, role) => {
    expect(role.temperature !== undefined && role.requireParameters === true).toBe(false)
  })

  it('gives synthesis no temperature but keeps reasoning off, JSON mode and require_parameters', () => {
    expect(SYNTH.temperature).toBeUndefined()
    expect(SYNTH).toMatchObject({ jsonMode: true, reasoning: { enabled: false }, requireParameters: true })
    expect(SYNTH.model).toBe('~anthropic/claude-haiku-latest')
  })

  it('extracts on a model that does not reason, with no JSON-mode, reasoning or provider option', () => {
    expect(EXTRACT).toEqual({ model: 'meta-llama/llama-3.1-8b-instruct', maxTokens: 400, temperature: 0.2, jsonMode: false })
    expect(PRICES[EXTRACT.model]).toEqual({ inPerM: 0.05, outPerM: 0.08 })
  })

  it('turns reasoning off on the check call and asks for nothing else', () => {
    expect(CHECK.reasoning).toEqual({ enabled: false })
    expect(CHECK.jsonMode).toBe(false)
    expect(CHECK.requireParameters).toBeUndefined()
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

  it('gives the synthesis call 1200 output tokens, above the 880 to 893 seen live', () => {
    expect(SYNTH.maxTokens).toBe(1_200)
  })

  it('times a model call out after 10 s, inside the run budget', () => {
    expect(CALL_TIMEOUT_MS).toBe(10_000)
    expect(CALL_TIMEOUT_MS).toBeLessThan(RUN_BUDGET_MS)
  })

  it('starts a retry only with at least 10 s of the budget left', () => {
    expect(MIN_RETRY_BUDGET_MS).toBe(10_000)
    expect(MIN_RETRY_BUDGET_MS).toBeLessThan(RUN_BUDGET_MS)
  })
})
