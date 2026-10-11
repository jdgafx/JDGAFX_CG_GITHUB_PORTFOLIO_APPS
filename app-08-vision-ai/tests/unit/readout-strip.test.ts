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
