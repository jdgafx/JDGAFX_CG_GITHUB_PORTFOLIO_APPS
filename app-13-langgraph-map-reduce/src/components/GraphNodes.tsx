import { STATE_WORD, stageWord } from '../lib/status'
import type { Branch, Status, StageName } from '../lib/view'

export const STAGE_LABEL: Record<StageName, string> = {
  split: 'Split',
  reduce: 'Reduce',
  synthesize: 'Synthesize',
  check: 'Check',
  final: 'Final',
}

/** The dot for a state. Running pulses, and the word beside it says the same thing. */
export function dotClass(status: Status): string {
  if (status === 'running') return 'ds-dot ds-dot--running'
  if (status === 'ok') return 'ds-dot ds-dot--ok'
  if (status === 'failed') return 'ds-dot ds-dot--failed'
  return 'ds-dot'
}

export function StageNode({ name, status, ended }: { name: StageName; status: Status; ended: boolean }) {
  return (
    <li className={`graph-node graph-node--${name} is-${status}`}>
      <span className="graph-node__name">{STAGE_LABEL[name]}</span>
      <span className="graph-node__state">
        <span className={dotClass(status)} aria-hidden="true" />
        {stageWord(status, ended)}
      </span>
    </li>
  )
}

export function ChunkNode({ branch }: { branch: Branch }) {
  const word = branch.status === 'ok' && branch.attempts > 1 ? 'Retried' : STATE_WORD[branch.status]
  return (
    <li className={`graph-chunk is-${branch.status}`}>
      <span className="graph-chunk__name">
        <span className={dotClass(branch.status)} aria-hidden="true" />
        Chunk {branch.chunk}
      </span>
      <span className="graph-chunk__state">{word}</span>
    </li>
  )
}

/** Shown before the split has counted the chunks, so the fan has a place before the run fills it. */
export function PlaceholderChunk({ ended }: { ended: boolean }) {
  return (
    <li className="graph-chunk is-idle">
      <span className="graph-chunk__name">
        <span className="ds-dot" aria-hidden="true" />
        Chunks
      </span>
      <span className="graph-chunk__state">{ended ? 'Not run' : 'Waiting'}</span>
    </li>
  )
}
