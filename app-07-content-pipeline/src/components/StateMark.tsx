import type { StageState } from '../lib/run'

const WORD: Record<StageState, string> = {
  waiting: 'Waiting',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
}

const DOT: Record<StageState, string> = {
  waiting: '',
  running: 'ds-dot--running',
  done: 'ds-dot--ok',
  failed: 'ds-dot--failed',
  skipped: 'ds-dot--skipped',
}

// Every state is a dot and a word, so no state is ever shown by colour alone.
export default function StateMark({ state }: { state: StageState }) {
  return (
    <span className="state-mark">
      <span className={`ds-dot ${DOT[state]}`.trim()} aria-hidden="true" />
      {WORD[state]}
    </span>
  )
}
