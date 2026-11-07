import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReportCard } from '../../src/components/ReportCard'
import { createAgents } from '../../src/lib/agents'
import { IDLE_AUDIT } from '../../src/lib/auditState'

const BADGE = 'REPLAY of a recorded run, not live'

function render(replay: boolean | undefined, output: string): string {
  const synthesizer = { ...createAgents().synthesizer, output }
  return renderToStaticMarkup(
    createElement(ReportCard, {
      phase: output ? 'complete' : 'running',
      synthesizer,
      sources: [],
      error: null,
      hasSteps: true,
      audit: IDLE_AUDIT,
      onRetryRun: () => undefined,
      onRetryAudit: () => undefined,
      replay,
    }),
  )
}

describe('the replay badge on the report', () => {
  it('shows on the report and on the loading state while the run is a replay', () => {
    for (const output of ['The report text.', '']) {
      const html = render(true, output)
      expect(html).toContain('data-replay-badge')
      expect(html).toContain(BADGE)
    }
  })

  it('is gone in a live run, and when the prop is left out', () => {
    for (const output of ['The report text.', '']) {
      expect(render(false, output)).not.toContain('data-replay-badge')
      expect(render(undefined, output)).not.toContain(BADGE)
    }
  })
})
