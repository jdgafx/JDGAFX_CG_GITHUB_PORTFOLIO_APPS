import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReadoutStrip } from '../../src/components/ReadoutStrip'
import type { RunSummary } from '../../src/types'

const summary = (over: Partial<RunSummary>): RunSummary => ({
  trace: [], usage: { total_tokens: 450, cost: 0.0012 }, model: 'anthropic/claude-haiku-5.5', newestModel: 'anthropic/claude-haiku-5.5', modelCheck: 'match', servedModels: [], totalMs: 30_000, unreportedCalls: 0, ...over,
})
const html = (s: RunSummary) => renderToStaticMarkup(createElement(ReadoutStrip, { phase: 'done', summary: s }))

describe('the cost and token readout', () => {
  it('shows a complete total plainly when every call reported its usage', () => {
    const out = html(summary({}))
    expect(out).toContain('$0.00120')
    expect(out).not.toContain('at least')
    expect(out).not.toContain('not reported')
  })

  it('says "at least" and how many calls are missing when a call did not report', () => {
    const out = html(summary({ unreportedCalls: 2 }))
    expect(out).toContain('at least $0.00120')
    expect(out).toContain('at least 450')
    expect(out).toContain('2 calls not reported')
  })

  it('says one call, in the singular', () => {
    expect(html(summary({ unreportedCalls: 1 }))).toContain('1 call not reported')
  })

  it('keeps the dash and "Not reported" when no call reported anything', () => {
    const out = html(summary({ usage: null, unreportedCalls: 1 }))
    expect(out).toContain('Not reported by the provider')
    expect(out).not.toContain('at least')
  })
})
