import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import ReadoutStrip from '../../src/components/ReadoutStrip'
import type { ModelCheck, RunView } from '../../src/types'

const SERVED = 'anthropic/claude-haiku-5.5'
const NEWER = 'anthropic/claude-haiku-5.6'
const OLDER = 'anthropic/claude-haiku-5.4'

function runWith(model: string | null, modelCheck: ModelCheck, newestModel: string | null, checkedModel = model): RunView {
  return { trace: [], usage: {}, model, newestModel, modelCheck, checkedModel, totalMs: 1200, outcome: 'done' }
}

function readout(run: RunView): string {
  return renderToStaticMarkup(createElement(ReadoutStrip, { running: false, run }))
}

describe('the served model chip in the readout', () => {
  it('shows the served id and "newest" when the list names it the newest model', () => {
    const html = readout(runWith(SERVED, 'match', SERVED))
    expect(html).toContain('claude-haiku-5.5 · newest')
    expect(html).toContain(`title="${SERVED}"`)
  })

  it('marks a served id that is not the newest, and puts the newest id in the title', () => {
    const html = readout(runWith(SERVED, 'mismatch', NEWER))
    expect(html).toContain('claude-haiku-5.5<span class="ds-trace__state--stopped"> · not newest</span>')
    expect(html).toContain(`title="${SERVED}, newest: ${NEWER}"`)
  })

  it('names the call that mismatched in the title when the shown reply came from a matching repair turn', () => {
    const html = readout(runWith(SERVED, 'mismatch', NEWER, OLDER))
    expect(html).toContain('claude-haiku-5.5<span class="ds-trace__state--stopped"> · not newest</span>')
    expect(html).toContain(`title="${OLDER}, newest: ${NEWER}"`)
  })

  it('shows unchecked when the list could not say which model is newest', () => {
    const html = readout(runWith(SERVED, 'unchecked', null))
    expect(html).toContain('claude-haiku-5.5 · unchecked')
    expect(html).toContain(`title="${SERVED}"`)
  })

  it('shows not reported with no marker when the reply named no model', () => {
    const html = readout(runWith(null, 'not-reported', null))
    expect(html).toContain('not reported')
    expect(html).not.toContain('newest')
    expect(html).not.toContain('unchecked')
  })
})
