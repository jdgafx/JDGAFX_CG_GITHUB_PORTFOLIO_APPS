import { describe, expect, it } from 'vitest'
import { CHECK, EXTRACT, MIN_RETRY_BUDGET_MS, PRICES, SYNTH } from '../../netlify/shared/models'
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
  it('ends the run at 25 s, well inside the roughly 30 s cut-off seen on the live site', () => {
    expect(RUN_BUDGET_MS).toBe(25_000)
    expect(RUN_BUDGET_MS).toBeLessThan(30_000)
  })

  it('starts a retry only with at least 10 s of the budget left', () => {
    expect(MIN_RETRY_BUDGET_MS).toBe(10_000)
    expect(MIN_RETRY_BUDGET_MS).toBeLessThan(RUN_BUDGET_MS)
  })
})
