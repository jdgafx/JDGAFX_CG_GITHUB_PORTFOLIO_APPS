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

function failedRun(over: Partial<RunView>): RunView {
  return { ...runWith(null, 'not-reported', null), outcome: 'failed', ...over }
}

describe('a partial total in the readout', () => {
  it('says "at least" and counts the calls not reported on a finished run', () => {
    const html = readout({ ...runWith(SERVED, 'match', SERVED), usage: { total_tokens: 1200, cost: 0.0002, unreportedCalls: 1 } })
    expect(html).toContain('at least 1,200')
    expect(html).toContain('at least $0.000200')
    expect(html).toContain('1 call not reported')
  })

  it('shows the spent figures with the count after a failure', () => {
    const html = readout(
      failedRun({
        trace: [{ name: 'Model call', status: 'failed', ms: 9, detail: 'x', tokens: 1200, cost: 0.0002, notReported: true }],
        usage: { total_tokens: 1200, cost: 0.0002, unreportedCalls: 1 },
      }),
    )
    expect(html).toContain('at least 1,200')
    expect(html).toContain('1 call not reported')
  })

  it('says not reported, never a zero, when no call reported anything', () => {
    const html = readout(failedRun({ trace: [{ name: 'Model call', status: 'failed', ms: 9, detail: 'x', notReported: true }], usage: { unreportedCalls: 1 } }))
    expect(html).toContain('not reported')
    expect(html).toContain('1 call not reported')
    expect(html).not.toContain('$0.000000')
  })

  it('leaves a complete total as it was', () => {
    const html = readout({ ...runWith(SERVED, 'match', SERVED), usage: { total_tokens: 1200, cost: 0.0002 } })
    expect(html).not.toContain('at least')
    expect(html).not.toContain('not reported</dd>')
  })
})

describe('the served model chip in the readout', () => {
  it('shows the served id and "newest" when the list names it the newest model', () => {
    const html = readout(runWith(SERVED, 'match', SERVED))
    expect(html).toContain('claude-haiku-5.5 · newest')
    expect(html).toContain(`class="ds-chip ds-chip--wrap" title="${SERVED}"`)
  })

  it('marks a served id that is not the newest, and puts the newest id in the title', () => {
    const html = readout(runWith(SERVED, 'mismatch', NEWER))
    expect(html).toContain('claude-haiku-5.5 · <span class="ds-trace__state--stopped">not newest</span>')
    expect(html).toContain(`title="${SERVED}, newest: ${NEWER}"`)
  })

  it('names the call that mismatched in the title when the shown reply came from a matching repair turn', () => {
    const html = readout(runWith(SERVED, 'mismatch', NEWER, OLDER))
    expect(html).toContain('claude-haiku-5.5 · <span class="ds-trace__state--stopped">not newest</span>')
    expect(html).toContain(`title="${OLDER}, newest: ${NEWER}"`)
  })

  it('shows unchecked when the list could not say which model is newest', () => {
    const html = readout(runWith(SERVED, 'unchecked', null))
    expect(html).toContain('claude-haiku-5.5 · unchecked')
    expect(html).toContain(`title="${SERVED}"`)
  })

  it('keeps not reported and adds the mismatch marker when the shown reply named no model but another try mismatched', () => {
    const html = readout(runWith(null, 'mismatch', NEWER, OLDER))
    expect(html).toContain('not reported · <span class="ds-trace__state--stopped">not newest</span>')
    expect(html).toContain(`title="${OLDER}, newest: ${NEWER}"`)
  })

  it('shows not reported with no marker when the reply named no model', () => {
    const html = readout(runWith(null, 'not-reported', null))
    expect(html).toContain('not reported')
    expect(html).not.toContain('newest')
    expect(html).not.toContain('unchecked')
  })
})
