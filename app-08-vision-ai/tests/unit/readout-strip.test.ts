import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RunSummary } from '../../src/lib/api'
import ReadoutStrip from '../../src/components/ReadoutStrip'

const NEWEST = 'anthropic/claude-haiku-5.5'
const OTHER = 'test/other-model'

function summaryWith(overrides: Partial<RunSummary>): RunSummary {
  return {
    trace: [],
    usage: null,
    servedModel: NEWEST,
    newestModel: NEWEST,
    modelCheck: 'match',
    mismatchedModel: null,
    totalMs: 1_200,
    unreportedCalls: 0,
    ...overrides,
  }
}

function modelCell(summary: RunSummary): string {
  return renderToStaticMarkup(createElement(ReadoutStrip, { status: 'complete', steps: [], summary }))
}

describe('ReadoutStrip served-model chip', () => {
  it('shows the served model with "newest" when it matches, and the full id in the title', () => {
    const html = modelCell(summaryWith({}))

    expect(html).toContain('claude-haiku-5.5')
    expect(html).toContain('Named in the provider reply <span>· newest</span>')
    expect(html).not.toContain('claude-haiku-5.5 · newest')
    expect(html).toContain(`title="${NEWEST}"`)
  })

  it('shows "not newest" on a mismatch, with the newest id in the title', () => {
    const html = modelCell(summaryWith({ servedModel: OTHER, modelCheck: 'mismatch', mismatchedModel: OTHER }))

    expect(html).toContain('Named in the provider reply <span class="ds-badge--warning">· not newest</span>')
    expect(html).toContain(`title="${OTHER}, newest: ${NEWEST}"`)
  })

  it('shows "unchecked" when the list gave no newest model', () => {
    const html = modelCell(summaryWith({ newestModel: null, modelCheck: 'unchecked' }))

    expect(html).toContain('Named in the provider reply <span>· unchecked</span>')
    expect(html).not.toContain('newest:')
  })

  it('shows "not reported" and no marker when the reply named no model', () => {
    const html = modelCell(summaryWith({ servedModel: null, newestModel: NEWEST, modelCheck: 'not-reported' }))

    expect(html).toContain('not reported')
    expect(html).not.toContain('·')
  })

  it('keeps "not newest" beside "not reported" when another call of the run mismatched', () => {
    const html = modelCell(summaryWith({ servedModel: null, modelCheck: 'mismatch', mismatchedModel: OTHER }))

    expect(html).toContain('not reported')
    expect(html).toContain('Named in the provider reply <span class="ds-badge--warning">· not newest</span>')
    expect(html).toContain(`title="${OTHER}, newest: ${NEWEST}"`)
  })
})

describe('ReadoutStrip totals', () => {
  const usage = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0012 }
  const html = (summary: RunSummary, status: 'complete' | 'failed' = 'complete') =>
    renderToStaticMarkup(createElement(ReadoutStrip, { status, steps: [], summary }))

  it('shows the totals as they are when every call reported', () => {
    const out = html(summaryWith({ usage }))
    expect(out).toContain('1,200')
    expect(out).toContain('$0.001200')
    expect(out).toContain('As the provider reports it')
    expect(out).not.toContain('at least')
  })

  it('shows "at least" and how many calls did not report when the total is partial', () => {
    const out = html(summaryWith({ usage, unreportedCalls: 1 }))
    expect(out).toContain('at least 1,200')
    expect(out).toContain('at least $0.001200')
    expect(out).toContain('1 call not reported')
    expect(out).not.toContain('As the provider reports it')
    expect(html(summaryWith({ usage, unreportedCalls: 2 }))).toContain('2 calls not reported')
  })

  it('keeps the partial wording on a failed run, with the spent-before-failing hint', () => {
    const out = html(summaryWith({ usage, unreportedCalls: 1 }), 'failed')
    expect(out).toContain('at least $0.001200')
    expect(out).toContain('1 call not reported')
  })

  it('shows not reported, not "at least", when no call reported anything', () => {
    const out = html(summaryWith({ usage: null, unreportedCalls: 2 }))
    expect(out).toContain('not reported')
    expect(out).not.toContain('at least')
    expect(out).toContain('2 calls not reported')
  })
})
