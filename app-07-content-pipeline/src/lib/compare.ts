import { bodyOf } from '../../netlify/shared/sourcepack'
import type { ChangeNote } from '../../netlify/shared/changes'
import type { StageOutputs } from '../../netlify/shared/contract'
import { diffStats, diffWords, type DiffSegment, type DiffStats } from '../../netlify/shared/diff'
import { readability, type Readability } from '../../netlify/shared/readability'

// The two steps that change a finished piece: the Edit works on the Draft, the Polish on the Edit.
export type ChangeStage = 'edit' | 'polish'
export const CHANGE_STAGES: readonly ChangeStage[] = ['edit', 'polish']
const PREVIOUS: Record<ChangeStage, 'draft' | 'edit'> = { edit: 'draft', polish: 'edit' }

export interface Comparison {
  stage: ChangeStage
  from: 'draft' | 'edit'
  segments: DiffSegment[]
  stats: DiffStats
  notes: ChangeNote[]
}

// Polish's output ends with the Sources list the function built; it is not part of the writing.
const writing = (stage: string, text: string): string => (stage === 'polish' ? bodyOf(text) : text)

/** The tracked changes of one step, or null until both the step and the one before it have finished. */
export function compareStage(stage: ChangeStage, outputs: StageOutputs, notes: Partial<Record<ChangeStage, ChangeNote[]>>): Comparison | null {
  const from = PREVIOUS[stage]
  const before = outputs[from]
  const after = outputs[stage]
  if (before === undefined || after === undefined) return null
  const segments = diffWords(writing(from, before), writing(stage, after))
  return { stage, from, segments, stats: diffStats(segments), notes: notes[stage] ?? [] }
}

export interface ReadabilityPoint {
  stage: 'draft' | 'edit' | 'polish'
  figures: Readability
}

/** Readability of each finished prose stage, in order. A stage that has not finished is left out. */
export function readabilityTrend(outputs: StageOutputs): ReadabilityPoint[] {
  return (['draft', 'edit', 'polish'] as const).flatMap(stage => {
    const text = outputs[stage]
    const figures = text === undefined ? null : readability(writing(stage, text))
    return figures ? [{ stage, figures }] : []
  })
}
