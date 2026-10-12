import { describe, expect, it } from 'vitest'
import * as models from '../../netlify/shared/models'
import {
  ATTRIBUTE,
  ATTRIBUTE_CALL_TIMEOUT_MS,
  CHECK,
  CHECK_BUDGET_MARGIN_MS,
  CHECK_CALL_TIMEOUT_MS,
  EXTRACT,
  EXTRACT_CALL_TIMEOUT_MS,
  EXTRACT_CONCURRENCY,
  EXTRACT_PHASE_MAX_MS,
  MIN_ATTRIBUTE_BUDGET_MS,
  MIN_CHECK_BUDGET_MS,
  MIN_RESYNTH_BUDGET_MS,
  MIN_RETRY_BUDGET_MS,
  MODEL,
  RETRY_CALL_TIMEOUT_MS,
  RETRY_PAUSE_MS,
  SYNTH,
  SYNTH_CALL_TIMEOUT_MS,
 } from '../../netlify/shared/models'
import { CALL_TIMEOUT_MS } from '../../netlify/shared/openrouter'
import { BUDGET_GRACE_MS, RUN_BUDGET_MS } from '../../netlify/shared/pipeline'

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
    expect(SYNTH).toEqual({ model: MODEL, maxTokens: 4_200, jsonMode: true, requireParameters: true })
    expect(ATTRIBUTE).toEqual({ model: MODEL, maxTokens: 1_800, jsonMode: true })
    for (const role of [EXTRACT, CHECK, SYNTH, ATTRIBUTE]) expect(role).not.toHaveProperty('reasoning')
  })

  it('leaves each cap room for about 500 thinking tokens above the largest live answer', () => {
    expect(EXTRACT.maxTokens).toBeGreaterThanOrEqual(495 + 500 + 1_000)
    // SP2 8adcac0 r1-c: 3,383 completion tokens in all, thinking included. The old 3,500 cap left it 117 tokens.
    expect(SYNTH.maxTokens).toBeGreaterThanOrEqual(Math.ceil(3_383 * 1.2))
    expect(CHECK.maxTokens).toBeGreaterThanOrEqual(12 + 500 + 1_000)
    // Largest attribution call in the points-fix prototype: 590 completion tokens, 519 of them thinking.
    expect(ATTRIBUTE.maxTokens).toBeGreaterThanOrEqual(590 * 3)
  })

  it('gives every role a different output cap, which the scripted tests use to tell the roles apart', () => {
    expect(new Set([EXTRACT.maxTokens, CHECK.maxTokens, SYNTH.maxTokens, ATTRIBUTE.maxTokens]).size).toBe(4)
  })

  it.each([
    ['extract', EXTRACT],
    ['check', CHECK],
    ['synthesis', SYNTH],
    ['attribution', ATTRIBUTE],
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
    for (const limit of [EXTRACT_CALL_TIMEOUT_MS, RETRY_CALL_TIMEOUT_MS, CHECK_CALL_TIMEOUT_MS]) expect(limit).toBeLessThan(SYNTH_CALL_TIMEOUT_MS)
    expect(SYNTH_CALL_TIMEOUT_MS).toBeLessThan(RUN_BUDGET_MS)
    expect(EXTRACT_CALL_TIMEOUT_MS + SYNTH_CALL_TIMEOUT_MS + CHECK_CALL_TIMEOUT_MS).toBeGreaterThan(RUN_BUDGET_MS)
  })
})

/**
 * The timing budget, pinned with where each number comes from. Sources (all under .acceptance/dw/es/):
 *   app-13-langgraph-map-reduce-sp2-8adcac0-2026-10-12/r*-api-run-0.sse, 8 preview runs of the chunk-citing prompt:
 *     synthesis 9,167 to 11,972 ms; slowest extract call 5,615 ms (r3-c chunk 6), all chunks running together;
 *     slowest review call 3,416 ms (r1-d); about 283 completion tokens per second (3,383 tokens in 11,972 ms).
 *   app-13-points-fix-2026-10-12/: a prompt that made the writer cite key point ids took 12.6 to 17.5 s, aborted at 16.0 s
 *     and 21.0 s, and once spent all 4,500 tokens thinking (synth-*.json, superseded-prompt-v1/, r1-a.json); one attribution
 *     call per chunk, all together, took 3,709 ms wall for 9 chunks, the slowest call 3,674 ms (attr-proto-r1.json); in the full
 *     run r1-a the same 9 calls took 1,243 to 5,388 ms, synthesis 10,359 ms and the review 3,314 ms (r1-a.json).
 *   the platform cut the function at about 30 s, and the run clock starts about 3 s after the request (pipeline.ts RUN_BUDGET_MS).
 * Synthesis, the attribution and the review cannot share a request with extract. They run in request 2, whose budget is the
 * whole 23 s.
 */
describe('the timing budget: request 2 holds synthesis, the key point check and the review', () => {
  const SLOWEST_ATTRIBUTION_MS = 5_388
  const SLOWEST_CHECK_MS = 3_416
  const SLOWEST_SYNTH_MS = 11_972
  const STARTUP_MS = 3_000

  it('keeps the synthesis timeout at 15 s, 3 s past the slowest call measured, with 4,200 tokens to write at 283 per second', () => {
    expect(SYNTH_CALL_TIMEOUT_MS).toBe(15_000)
    expect(SYNTH_CALL_TIMEOUT_MS - SLOWEST_SYNTH_MS).toBeGreaterThanOrEqual(3_000)
    expect(SYNTH.maxTokens).toBe(4_200)
    expect(SYNTH.maxTokens).toBeLessThanOrEqual((SYNTH_CALL_TIMEOUT_MS / 1_000) * 283)
  })

  it('leaves the attribution its time even when synthesis takes its whole timeout', () => {
    expect(ATTRIBUTE_CALL_TIMEOUT_MS).toBe(7_000)
    expect(ATTRIBUTE_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(SLOWEST_ATTRIBUTION_MS * 1.25)
    expect(MIN_ATTRIBUTE_BUDGET_MS).toBe(6_400)
    expect(MIN_ATTRIBUTE_BUDGET_MS).toBeGreaterThanOrEqual(SLOWEST_ATTRIBUTION_MS + CHECK_BUDGET_MARGIN_MS)
    expect(RUN_BUDGET_MS - SYNTH_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(ATTRIBUTE_CALL_TIMEOUT_MS + CHECK_BUDGET_MARGIN_MS)
  })

  it('would not fit one request: with extract in front, a full-length synthesis leaves no room for the attribution', () => {
    expect(EXTRACT_PHASE_MAX_MS).toBe(5_615)
    expect(EXTRACT_PHASE_MAX_MS + SYNTH_CALL_TIMEOUT_MS + MIN_ATTRIBUTE_BUDGET_MS).toBeGreaterThan(RUN_BUDGET_MS)
    // A typical run (synthesis 10,359 ms in r1-a) would still have no room for the review behind them.
    expect(EXTRACT_PHASE_MAX_MS + 10_359 + SLOWEST_ATTRIBUTION_MS + MIN_CHECK_BUDGET_MS).toBeGreaterThan(RUN_BUDGET_MS)
  })

  it('keeps each request, start-up, run budget and grace, under the 30 s platform cut-off', () => {
    expect(RUN_BUDGET_MS).toBe(23_000)
    expect(BUDGET_GRACE_MS).toBe(1_000)
    expect(STARTUP_MS + RUN_BUDGET_MS + BUDGET_GRACE_MS).toBeLessThan(30_000)
  })

  it('starts the review only with room for the slowest review seen plus the margin that ends it before the budget does', () => {
    expect(CHECK_BUDGET_MARGIN_MS).toBe(1_000)
    expect(MIN_CHECK_BUDGET_MS).toBe(4_500)
    expect(MIN_CHECK_BUDGET_MS).toBeGreaterThanOrEqual(SLOWEST_CHECK_MS + CHECK_BUDGET_MARGIN_MS)
    // A typical synthesis (10,359 ms in r1-a), then the slowest attribution seen, still leaves room for the review in request 2.
    expect(RUN_BUDGET_MS - 10_359 - SLOWEST_ATTRIBUTION_MS).toBeGreaterThanOrEqual(MIN_CHECK_BUDGET_MS)
  })
})
