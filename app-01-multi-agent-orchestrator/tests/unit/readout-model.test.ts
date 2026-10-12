import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReadoutStrip } from '../../src/components/ReadoutStrip'
import { IDLE_AUDIT } from '../../src/lib/auditState'
import type { ModelFacts } from '../../src/types'

const NEWEST = 'anthropic/claude-haiku-5.5'
const OLDER = 'anthropic/claude-haiku-4.5'
const match: ModelFacts = { servedModel: NEWEST, newestModel: NEWEST, modelCheck: 'match' }
const mismatch: ModelFacts = { servedModel: OLDER, newestModel: NEWEST, modelCheck: 'mismatch' }

/** The readout for a run whose reply-producing call is `model` and whose calls are `calls` (default: that call alone). */
function readout(model: ModelFacts | undefined, calls: ModelFacts[] = model ? [model] : []) {
  return renderToStaticMarkup(
    createElement(ReadoutStrip, { state: 'done', totalMs: 1200, totalIsStageSum: false, usage: {}, model, calls, summary: null, audit: IDLE_AUDIT }),
  )
}

describe('served-model chip and marker', () => {
  it('marks a match as newest and keeps the id in the chip title', () => {
    const out = readout(match)
    expect(out).toContain('claude-haiku-5.5')
    expect(out).toContain('· newest')
    expect(out).toContain(`title="${NEWEST}"`)
    expect(out).not.toContain('not newest')
  })

  it('marks a mismatch as not newest, with the mismatching id and the newest in the marker title', () => {
    const out = readout(mismatch)
    expect(out).toMatch(new RegExp(`<span class="ds-chip ds-chip--wrap" title="${OLDER}, newest: ${NEWEST}">claude-haiku-4\\.5 <span[^>]*>· not newest</span></span>`))
    expect(out).not.toContain('ds-badge')
  })

  it('marks an unchecked model as unchecked', () => {
    const out = readout({ servedModel: NEWEST, newestModel: null, modelCheck: 'unchecked' })
    expect(out).toContain('· unchecked')
    expect(out).toContain(`title="${NEWEST}"`)
  })

  it('shows not reported with no marker when the reply named no model', () => {
    const out = readout({ servedModel: null, newestModel: NEWEST, modelCheck: 'not-reported' })
    expect(out).toContain('not reported')
    expect(out).not.toContain('·')
    expect(out).not.toContain('title=')
  })
})

describe('run-wide marker: the worst check across the run calls', () => {
  it('shows not newest when one stage matches and another mismatches, keeping the reply call id', () => {
    const out = readout(match, [mismatch, match])
    expect(out).toMatch(new RegExp(`<span class="ds-chip ds-chip--wrap" title="${OLDER}, newest: ${NEWEST}">claude-haiku-5\\.5 <span[^>]*>· not newest</span></span>`))
    expect(out).not.toContain('· newest')
  })

  it('ranks unchecked above match', () => {
    const unchecked: ModelFacts = { servedModel: NEWEST, newestModel: null, modelCheck: 'unchecked' }
    expect(readout(match, [match, unchecked])).toContain('· unchecked')
  })

  it('ranks not reported above unchecked, and then shows no marker', () => {
    const unchecked: ModelFacts = { servedModel: NEWEST, newestModel: null, modelCheck: 'unchecked' }
    const unreported: ModelFacts = { servedModel: null, newestModel: NEWEST, modelCheck: 'not-reported' }
    const out = readout(match, [unchecked, unreported])
    expect(out).not.toContain('·')
    expect(out).toContain('claude-haiku-5.5')
  })

  it('shows the audit id chip with the run marker when the audit call is the mismatch', () => {
    const out = renderToStaticMarkup(
      createElement(ReadoutStrip, {
        state: 'done',
        totalMs: 1200,
        totalIsStageSum: false,
        usage: {},
        model: match,
        calls: [match, mismatch],
        summary: null,
        audit: { ...IDLE_AUDIT, phase: 'done', result: { claims: [], summary: { total: 0, supported: 0, partly: 0, unsupported: 0, unchecked: 0, unverified: 0 }, overLimit: 0, usage: {}, ms: 1, model: mismatch } },
      }),
    )
    expect(out).toContain('claude-haiku-4.5')
    expect(out).toContain('· not newest')
    expect(out).toContain(`title="${OLDER}, newest: ${NEWEST}"`)
  })
})
