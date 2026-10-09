import type { RunPhase } from './useResultFocus'
import type { Phase } from './run-state'

/**
 * The design system and the result-focus hook know idle, running, done, failed and stopped. A run paused for a
 * maintainer has ended its stream with a card to answer, so it counts as done: the card leads and takes focus.
 */
export function runAttr(phase: Phase): RunPhase {
  return phase === 'paused' ? 'done' : phase
}

interface Badge {
  word: string
  tone: '' | 'accent' | 'success' | 'warning' | 'danger'
  dot: string
}

export const PHASE_BADGE: Record<Phase, Badge> = {
  idle: { word: 'Ready', tone: '', dot: 'ds-dot--skipped' },
  running: { word: 'Running', tone: 'accent', dot: 'ds-dot--running' },
  paused: { word: 'Awaiting a maintainer', tone: 'warning', dot: 'ds-dot--paused' },
  done: { word: 'Completed', tone: 'success', dot: 'ds-dot--ok' },
  failed: { word: 'Failed', tone: 'danger', dot: 'ds-dot--failed' },
  stopped: { word: 'Stopped', tone: 'warning', dot: 'ds-dot--stopped' },
}
