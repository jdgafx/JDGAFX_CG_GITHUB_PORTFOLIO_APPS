import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReadoutStrip } from '../../src/components/ReadoutStrip'
import { modelMarker, modelTitle } from '../../src/lib/format'
import type { LatestRun, ModelCheck, RunReport } from '../../src/types'

const SERVED = 'anthropic/claude-haiku-5-5'
const NEWER = 'anthropic/claude-haiku-6.0'

const report = (servedModel: string | null, newestModel: string | null, modelCheck: ModelCheck, mismatchedModel: string | null = null): RunReport => ({
  trace: [],
  usage: null,
  servedModel,
  newestModel,
  modelCheck,
  mismatchedModel,
  totalMs: 120,
})

const strip = (latest: LatestRun | null) =>
  renderToStaticMarkup(createElement(ReadoutStrip, { running: false, pending: null, liveTrace: [], latest, sent: 0, total: 0 }))

describe('model marker and title', () => {
  it('marks the served model against the newest one', () => {
    expect(modelMarker('match')).toBe('· newest')
    expect(modelMarker('mismatch')).toBe('· not newest')
    expect(modelMarker('unchecked')).toBe('· unchecked')
    expect(modelMarker('not-reported')).toBeNull()
  })

  it('keeps the full served id in the title, and names the mismatched call with the newest id', () => {
    expect(modelTitle(SERVED, NEWER, null)).toBe(SERVED)
    expect(modelTitle(SERVED, NEWER, SERVED)).toBe(`${SERVED}, newest: ${NEWER}`)
  })
})

describe('the served-model chip in the run readout', () => {
  it('shows the served model with a newest marker when it is the newest', () => {
    const html = strip({ report: report(SERVED, SERVED, 'match'), state: 'answered' })
    expect(html).toContain('claude-haiku-5-5')
    expect(html).toContain('· newest')
    expect(html).toContain(`title="${SERVED}"`)
  })

  it('shows a mismatch with a warning marker and the newest id in the title', () => {
    const html = strip({ report: report(SERVED, NEWER, 'mismatch', SERVED), state: 'answered' })
    expect(html).toContain('· not newest')
    expect(html).toContain('ds-badge--warning')
    expect(html).toContain(`title="${SERVED}, newest: ${NEWER}"`)
  })

  it('marks a run with one matching call and one mismatching call as not newest, naming the mismatching call in the title', () => {
    const html = strip({ report: report(NEWER, NEWER, 'mismatch', SERVED), state: 'answered' })
    expect(html).toContain('· not newest')
    expect(html).toContain(`title="${SERVED}, newest: ${NEWER}"`)
  })

  it('shows unchecked when the list did not name the newest model', () => {
    const html = strip({ report: report(SERVED, null, 'unchecked'), state: 'answered' })
    expect(html).toContain('· unchecked')
    expect(html).not.toContain('ds-badge--warning')
  })

  it('shows not reported, with no marker, when the answer named no model', () => {
    const html = strip({ report: report(null, null, 'not-reported'), state: 'answered' })
    expect(html).toContain('not reported')
    expect(html).not.toContain('·')
  })

  it('shows a dash before any run', () => {
    const html = strip(null)
    expect(html).not.toContain('not reported')
    expect(html).toContain('—')
  })
})
