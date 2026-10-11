import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { modelReadoutOf, TraceCard } from '../../src/components/TraceCard'
import { emptyRun } from '../../src/lib/run-state'
import type { TraceRow } from '../../src/types'

const NEWEST = 'anthropic/claude-haiku-5.5'
const row = (fields: Partial<TraceRow>): TraceRow => ({ node: 'duplicates', status: 'ok', ms: 900, detail: 'Judged.', ...fields })

describe('modelReadoutOf', () => {
  it('shows the served id and "newest" when it matches the newest model', () => {
    expect(modelReadoutOf(row({ model: NEWEST, newestModel: NEWEST, modelCheck: 'match' }))).toEqual({
      chip: 'claude-haiku-5.5',
      marker: '· newest',
      warn: false,
      title: NEWEST,
    })
  })

  it('shows the served id, "not newest" as a warning, and the full served and newest ids in the title when another model answered', () => {
    expect(modelReadoutOf(row({ model: 'anthropic/claude-haiku-5', newestModel: NEWEST, modelCheck: 'mismatch' }))).toEqual({
      chip: 'claude-haiku-5',
      marker: '· not newest',
      warn: true,
      title: `anthropic/claude-haiku-5, newest: ${NEWEST}`,
    })
  })

  it('shows the served id and "unchecked" when the list gave no newest model', () => {
    expect(modelReadoutOf(row({ model: NEWEST, newestModel: null, modelCheck: 'unchecked' }))).toEqual({
      chip: 'claude-haiku-5.5',
      marker: '· unchecked',
      warn: false,
      title: NEWEST,
    })
  })

  it('shows "not reported" and no marker when the reply named no model', () => {
    expect(modelReadoutOf(row({ model: null, newestModel: NEWEST, modelCheck: 'not-reported' }))).toEqual({
      chip: 'not reported',
      marker: null,
      warn: false,
      title: undefined,
    })
  })

  it('reads a row from before the check exactly as it always did: the id and no marker', () => {
    expect(modelReadoutOf(row({ model: NEWEST }))).toEqual({ chip: 'claude-haiku-5.5', marker: null, warn: false, title: NEWEST })
  })
})

describe('the served-model chip in the trace', () => {
  function chipsOf(trace: TraceRow[]): string {
    return renderToStaticMarkup(createElement(TraceCard, { run: { ...emptyRun(), trace }, current: null, phase: 'done' }))
  }

  it('renders the marker inside the chip, in the warning colour for a mismatch', () => {
    const html = chipsOf([row({ model: 'anthropic/claude-haiku-5', newestModel: NEWEST, modelCheck: 'mismatch' })])

    expect(html).toContain(`title="anthropic/claude-haiku-5, newest: ${NEWEST}"`)
    expect(html).toContain('claude-haiku-5<span class="ds-trace__state--stopped">· not newest</span>')
  })

  it('renders "not reported" for a call whose reply named no model', () => {
    expect(chipsOf([row({ model: null, newestModel: NEWEST, modelCheck: 'not-reported' })])).toContain('>not reported</span>')
  })

  it('renders no chip for a step that made no model call', () => {
    expect(chipsOf([row({})])).not.toContain('ds-chip')
  })
})
