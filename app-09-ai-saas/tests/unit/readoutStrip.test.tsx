import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ReadoutStrip from '../../src/components/ReadoutStrip'
import type { RunOutcome } from '../../src/lib/api'
import type { InsightRun } from '../../src/lib/insightRun'

const SERVED = 'anthropic/claude-haiku-5.5'
const OUTCOME: RunOutcome = {
  result: 'React rose 3.2%.',
  trace: [],
  usage: null,
  servedModel: SERVED,
  newestModel: SERVED,
  modelCheck: 'match',
  totalMs: 640,
}

function readoutFor(outcome: RunOutcome): string {
  const run: InsightRun = {
    status: 'done',
    steps: [],
    answer: outcome.result,
    outcome,
    totalMs: outcome.totalMs,
    errorMessage: '',
    generate: async () => undefined,
    stop: () => undefined,
  }
  return renderToStaticMarkup(<ReadoutStrip run={run} />)
}

describe('ReadoutStrip: the served model chip and its marker', () => {
  it('shows the served model with "· newest" when it is the newest', () => {
    const html = readoutFor(OUTCOME)
    expect(html).toContain('claude-haiku-5.5')
    expect(html).toContain('· newest')
  })

  it('shows a warning "· not newest" marker, with the newest model in its title, when the served model is not the newest', () => {
    const html = readoutFor({ ...OUTCOME, servedModel: 'anthropic/claude-haiku-5.4', modelCheck: 'mismatch', newestModel: SERVED })
    expect(html).toContain('claude-haiku-5.4')
    expect(html).toContain('ds-badge ds-badge--warning')
    expect(html).toContain('· not newest')
    expect(html).toContain(`title="newest: ${SERVED}"`)
  })

  it('shows "· unchecked" when the list did not say which model is newest', () => {
    const html = readoutFor({ ...OUTCOME, newestModel: null, modelCheck: 'unchecked' })
    expect(html).toContain('· unchecked')
  })

  it('shows "not reported" and no marker when the reply named no model', () => {
    const html = readoutFor({ ...OUTCOME, servedModel: null, newestModel: SERVED, modelCheck: 'not-reported' })
    expect(html).toContain('not reported')
    expect(html).not.toContain('· ')
  })
})
