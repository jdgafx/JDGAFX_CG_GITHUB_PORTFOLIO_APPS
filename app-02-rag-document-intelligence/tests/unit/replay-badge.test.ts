import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResultCard } from '../../src/components/ResultCard'

const BADGE = 'REPLAY of a recorded run, not live'

function render(replay: boolean | undefined, phase: 'idle' | 'running' | 'failed'): string {
  return renderToStaticMarkup(
    createElement(ResultCard, {
      doc: null,
      phase,
      turns: [],
      error: null,
      hasSteps: false,
      selection: null,
      onSelect: () => undefined,
      onClose: () => undefined,
      onRetry: () => undefined,
      replay,
    }),
  )
}

describe('the replay badge on the answer', () => {
  it('shows on the answer area while the run is a replay', () => {
    for (const phase of ['idle', 'running', 'failed'] as const) {
      const html = render(true, phase)
      expect(html).toContain('data-replay-badge')
      expect(html).toContain(BADGE)
    }
  })

  it('is gone in a live run, and when the prop is left out', () => {
    for (const phase of ['idle', 'running', 'failed'] as const) {
      expect(render(false, phase)).not.toContain('data-replay-badge')
      expect(render(undefined, phase)).not.toContain(BADGE)
    }
  })
})
