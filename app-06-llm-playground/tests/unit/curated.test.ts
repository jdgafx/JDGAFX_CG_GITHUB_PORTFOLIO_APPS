import { describe, expect, it } from 'vitest'
import { CURATED_GROUPS } from '../../netlify/shared/curated'
import { DEFAULT_PICKS } from '../../src/lib/run'
import {
  ANSWER_MAX_CHARS,
  COMPARE_BODY_MAX_BYTES,
  COMPARE_MAX_TOKENS,
  JUDGE_BODY_MAX_BYTES,
  JUDGE_MAX_TOKENS,
  JUDGE_TOTAL_MAX_CHARS,
  MODEL,
  MODEL_ID_MAX_CHARS,
  PROMPT_MAX_CHARS,
  SYSTEM_MAX_CHARS,
} from '../../netlify/shared/contract'

const ids = CURATED_GROUPS.flatMap(group => group.items.map(([id]) => id))

describe('curated picker list', () => {
  it('has five groups, each model listed once', () => {
    // A stale copy of a model in two groups would show twice in the picker.
    expect(CURATED_GROUPS.map(group => group.label)).toEqual([
      'Speed and latency',
      'Reasoning',
      'Agentic and coding',
      'Price and value',
      'Frontier quality',
    ])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(24)
  })

  it('uses provider/model IDs only', () => {
    for (const id of ids) expect(id).toMatch(/^~?[a-z0-9.-]+\/[a-z0-9.+-]+$/i)
  })

  it('starts panels B and C from curated IDs', () => {
    expect(DEFAULT_PICKS).toEqual({ B: 'google/gemini-2.5-flash-lite', C: 'anthropic/claude-sonnet-5' })
    expect(ids).toContain(DEFAULT_PICKS.B)
    expect(ids).toContain(DEFAULT_PICKS.C)
  })
})

describe('contract limits', () => {
  it('keeps panel A on the fixed model', () => {
    expect(MODEL).toBe('~anthropic/claude-haiku-latest')
  })

  it('derives the body limits from the text limits, at 6 bytes per character plus 4096 for keys', () => {
    expect(PROMPT_MAX_CHARS).toBe(4000)
    expect(SYSTEM_MAX_CHARS).toBe(2000)
    expect(ANSWER_MAX_CHARS).toBe(8000)
    expect(JUDGE_TOTAL_MAX_CHARS).toBe(20_000)
    expect(COMPARE_BODY_MAX_BYTES).toBe(40_096)
    expect(JUDGE_BODY_MAX_BYTES).toBe(148_096)
  })

  it('keeps the output caps and the model ID length limit', () => {
    expect(COMPARE_MAX_TOKENS).toBe(2048)
    expect(JUDGE_MAX_TOKENS).toBe(1024)
    expect(MODEL_ID_MAX_CHARS).toBe(200)
  })
})
