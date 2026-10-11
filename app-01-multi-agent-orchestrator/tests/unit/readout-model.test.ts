import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReadoutStrip } from '../../src/components/ReadoutStrip'
import { IDLE_AUDIT } from '../../src/lib/auditState'
import type { ModelFacts } from '../../src/types'

const NEWEST = 'anthropic/claude-haiku-5.5'
const OLDER = 'anthropic/claude-haiku-4.5'

function readout(model: ModelFacts | undefined) {
  return renderToStaticMarkup(
    createElement(ReadoutStrip, { state: 'done', totalMs: 1200, totalIsStageSum: false, usage: {}, model, summary: null, audit: IDLE_AUDIT }),
  )
}

describe('served-model chip', () => {
  it('marks a match as newest and keeps the id in the title', () => {
    const out = readout({ servedModel: NEWEST, newestModel: NEWEST, modelCheck: 'match' })
    expect(out).toContain('claude-haiku-5.5')
    expect(out).toContain('· newest')
    expect(out).toContain(`title="${NEWEST}"`)
    expect(out).not.toContain('not newest')
  })

  it('marks a mismatch as not newest, with the newest id in the title and the warning badge', () => {
    const out = readout({ servedModel: OLDER, newestModel: NEWEST, modelCheck: 'mismatch' })
    expect(out).toContain('claude-haiku-4.5')
    expect(out).toContain('· not newest')
    expect(out).toContain('ds-badge--warning')
    expect(out).toContain(`title="${OLDER}, newest: ${NEWEST}"`)
  })

  it('marks an unchecked model as unchecked, with the served id as the title', () => {
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
