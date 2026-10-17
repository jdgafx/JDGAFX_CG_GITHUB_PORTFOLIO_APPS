import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResultCard } from '../../src/components/ResultCard'
import { emptyRun } from '../../src/lib/run-state'
import { NO_STREAM } from '../../src/lib/stream-view'

const BADGE = 'REPLAY of a recorded run, not live'

function render(replay: boolean, phase: 'idle' | 'running' | 'failed'): string {
  return renderToStaticMarkup(
    createElement(ResultCard, {
      run: emptyRun(),
      phase,
      flow: NO_STREAM,
      busy: phase === 'running',
      replay,
      searching: false,
      onDecide: () => undefined,
      onRetry: () => undefined,
      onAgain: () => undefined,
      onRefreshThreads: () => undefined,
    }),
  )
}

describe('the replay badge on the triage result', () => {
  it('shows on the result area while the run is a replay', () => {
    for (const phase of ['idle', 'running', 'failed'] as const) {
      const html = render(true, phase)
      expect(html).toContain('data-replay-badge')
      expect(html).toContain(BADGE)
    }
  })

  it('is gone in a live run', () => {
    for (const phase of ['idle', 'running', 'failed'] as const) {
      expect(render(false, phase)).not.toContain('data-replay-badge')
    }
  })
})
