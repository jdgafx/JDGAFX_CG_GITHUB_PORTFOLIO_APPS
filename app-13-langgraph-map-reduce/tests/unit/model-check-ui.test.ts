import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { priceCall } from '../../netlify/shared/cost'
import { checkMarker, ReadoutStrip } from '../../src/components/ReadoutStrip'
import { metricsFor, worstModelCheck } from '../../src/lib/metrics'
import { initialView, type RunView } from '../../src/lib/view'
import type { ModelCheck, TraceRow } from '../../src/types/frames'
import { recordedPrices, SERVED_MODEL } from '../helpers/prices'

const NEWEST = SERVED_MODEL
const OTHER = 'anthropic/claude-haiku-4.5'
const usage = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 }

/** An answered call row with its model check, the way the server records it. */
function call(node: TraceRow['node'], servedModel: string | null, modelCheck: ModelCheck, newestModel: string | null = NEWEST): TraceRow {
  return {
    node,
    status: 'ok',
    ms: 5,
    detail: node,
    model: '~anthropic/claude-haiku-latest',
    servedModel,
    newestModel,
    modelCheck,
    usage,
    ...priceCall(recordedPrices(), servedModel, usage),
  }
}

/** A finished run's view over these rows. */
function finished(rows: TraceRow[]): RunView {
  const result = {
    summary: { overview: 'o', sections: [] },
    coverage: { covered: [1], missing: [], noPoints: [], citedPoints: [], uncitedPoints: [], unchecked: [] },
    reviewFlags: [],
    review: 'not-needed' as const,
    entities: [],
    retries: 0,
    chunkCount: 1,
    findingCount: 1,
    keyPoints: [],
    notice: null,
    retryOutcome: 'none' as const,
    metrics: metricsFor(rows, 5),
  }
  return { ...initialView(), phase: 'done', rows, result }
}

const html = (rows: TraceRow[]): string => renderToStaticMarkup(createElement(ReadoutStrip, { view: finished(rows) }))

describe('worstModelCheck', () => {
  it('ranks mismatch above not-reported, not-reported above unchecked, and unchecked above match', () => {
    expect(worstModelCheck([call('extract', NEWEST, 'match'), call('check', NEWEST, 'unchecked')])).toBe('unchecked')
    expect(worstModelCheck([call('extract', NEWEST, 'unchecked'), call('check', null, 'not-reported')])).toBe('not-reported')
    expect(worstModelCheck([call('extract', null, 'not-reported'), call('check', OTHER, 'mismatch')])).toBe('mismatch')
  })

  it('takes the worst across all calls, so one mismatch among matching calls is the check', () => {
    expect(worstModelCheck([call('extract', NEWEST, 'match'), call('extract', OTHER, 'mismatch'), call('synthesize', NEWEST, 'match')])).toBe('mismatch')
  })

  it('leaves out a call with no reply, which has no check, so a timed-out chunk does not change the readout', () => {
    const timedOut: TraceRow = { node: 'extract', status: 'failed', ms: 6000, detail: 'chunk 2 of 3', model: '~anthropic/claude-haiku-latest', message: 'timed out' }

    expect(worstModelCheck([call('extract', NEWEST, 'match'), timedOut])).toBe('match')
    expect(worstModelCheck([timedOut])).toBeNull()
  })
})

describe('checkMarker', () => {
  it.each<[ModelCheck, string | null]>([
    ['match', '· newest'],
    ['unchecked', '· unchecked'],
    ['mismatch', '· not newest'],
    ['not-reported', null],
  ])('shows %s as %j', (check, text) => {
    expect(checkMarker([call('extract', check === 'not-reported' ? null : NEWEST, check)])?.text ?? null).toBe(text)
  })

  it('shows "· not newest" when one call matches and another mismatches', () => {
    expect(checkMarker([call('extract', NEWEST, 'match'), call('synthesize', OTHER, 'mismatch')])?.text).toBe('· not newest')
  })
})

describe('ReadoutStrip model cell', () => {
  it('shows the served id and "· newest" when every call matches', () => {
    const page = html([call('extract', NEWEST, 'match'), call('synthesize', NEWEST, 'match')])

    expect(page).toContain('· newest')
    expect(page).toContain(`title="served by ${NEWEST}"`)
  })

  it('shows "· not newest" in the warning style, and the title names the mismatching served id and the newest id', () => {
    const page = html([call('extract', NEWEST, 'match'), call('synthesize', OTHER, 'mismatch')])

    expect(page).toContain('· not newest')
    expect(page).toContain('ds-badge--warning')
    expect(page).toContain(`title="served by ${OTHER}, newest: ${NEWEST}"`)
  })

  it('shows "· unchecked" when the list named no newest model', () => {
    const page = html([call('extract', NEWEST, 'unchecked', null)])

    expect(page).toContain('· unchecked')
    expect(page).not.toContain('· newest')
  })

  it('shows "served model not reported" and no marker when the reply named no model', () => {
    const page = html([call('extract', null, 'not-reported')])

    expect(page).toContain('served model not reported')
    expect(page).not.toMatch(/· (newest|not newest|unchecked)/)
  })
})
