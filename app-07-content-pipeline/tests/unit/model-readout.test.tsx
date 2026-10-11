import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { STAGE_LABELS, type ModelCheck, type StageId, type Usage } from '../../netlify/shared/contract'
import type { CallRecord } from '../../src/lib/api'
import Readout from '../../src/components/Readout'
import RunTrace from '../../src/components/RunTrace'
import { buildTrace, summarize } from '../../src/lib/run'

const NEWEST = 'anthropic/claude-haiku-5.5'
const OTHER = 'anthropic/claude-haiku-5.4'
const USAGE: Usage = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 }

function call(stage: StageId, model: string | null, modelCheck: ModelCheck | null, status: 'ok' | 'failed' = 'ok'): CallRecord {
  return {
    stage,
    row: { name: STAGE_LABELS[stage], status, ms: 900, detail: 'detail', tokens: USAGE.total_tokens, cost: USAGE.cost },
    usage: USAGE,
    model,
    newestModel: model ? NEWEST : null,
    modelCheck,
  }
}

// The served-model chip on one trace line, as the page draws it.
function traceHtml(modelCheck: ModelCheck, model: string | null = NEWEST): string {
  return renderToStaticMarkup(<RunTrace lines={buildTrace([call('research', model, modelCheck)], {}, null)} />)
}

// The Model cell of the run readout, once the run has ended.
function readoutHtml(calls: CallRecord[]): string {
  return renderToStaticMarkup(<Readout phase="done" totals={summarize(calls)} runningStage={null} startedAt={0} />)
}

describe('served-model chip on a trace line', () => {
  it('shows the served id and "newest" when it matches, with the full id as the title', () => {
    const html = traceHtml('match')
    expect(html).toContain('>claude-haiku-5.5 <')
    expect(html).toContain('· newest')
    expect(html).toContain(`title="${NEWEST}"`)
  })

  it('shows "not newest" in the warning style on a mismatch, and names the newest id in the title', () => {
    const html = traceHtml('mismatch', OTHER)
    expect(html).toContain('>claude-haiku-5.4 <')
    expect(html).toContain('· not newest')
    expect(html).toContain('class="ds-trace__state--stopped"')
    expect(html).toContain(`title="${OTHER}, newest: ${NEWEST}"`)
  })

  it('shows "unchecked" when the list could not be read', () => {
    expect(traceHtml('unchecked')).toContain('· unchecked')
  })

  it('shows "not reported" and no marker when the reply named no model', () => {
    const html = traceHtml('not-reported', null)
    expect(html).toContain('not reported')
    expect(html).not.toContain('·')
    expect(html).not.toContain('title=')
  })
})

describe('served-model readout for a run', () => {
  it('shows the reply call\'s served id, and "not newest" when another call mismatched, with the mismatching call named in the title', () => {
    const html = readoutHtml([call('research', NEWEST, 'match'), call('outline', OTHER, 'mismatch')])
    expect(html).toContain('>claude-haiku-5.4 <')
    expect(html).toContain('· not newest')
    expect(html).toContain(`title="${OTHER}, newest: ${NEWEST}"`)
  })

  it('keeps "not newest" when the mismatching call came before a matching one, and shows the reply call\'s id', () => {
    const html = readoutHtml([call('research', OTHER, 'mismatch'), call('outline', NEWEST, 'match')])
    expect(html).toContain('>claude-haiku-5.5 <')
    expect(html).toContain('· not newest')
    expect(html).toContain(`title="${OTHER}, newest: ${NEWEST}"`)
  })

  it('shows "newest" when every writing call matched, and leaves the Sources lookup out of the check', () => {
    const sources = { ...call('sources', null, 'not-reported'), row: { name: 'Sources', status: 'ok' as const, ms: 400, detail: 'd' }, usage: null }
    const html = readoutHtml([sources, call('research', NEWEST, 'match')])
    expect(html).toContain('>claude-haiku-5.5 <')
    expect(html).toContain('· newest')
  })

  it('shows "newest" when the model calls matched, though a call the browser made when the server sent no answer has no check', () => {
    const watchdog = call('outline', null, null, 'failed')
    const html = readoutHtml([call('research', NEWEST, 'match'), watchdog])
    expect(html).toContain('· newest')
  })

  it('shows "unchecked" when the list could not be read', () => {
    expect(readoutHtml([call('research', NEWEST, 'unchecked')])).toContain('· unchecked')
  })

  it('shows "not reported" and no marker when the reply named no model', () => {
    const html = readoutHtml([call('research', null, 'not-reported')])
    expect(html).toContain('not reported')
    expect(html).not.toContain('·')
  })
})
