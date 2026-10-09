import type { ReviewComment, TraceStep, Verdict } from '../types'

export const VERDICT_ORDER: Verdict[] = ['kept', 'moved', 'dropped', 'unverified']

/** The word and the marker for each verdict. The marker repeats the word, so colour is never the only signal. */
export const VERDICT_WORD: Record<Verdict, { word: string; chip: string; mark: string }> = {
  kept: { word: 'Kept', chip: 'ds-chip ds-chip--add', mark: '+' },
  moved: { word: 'Moved', chip: 'ds-chip ds-chip--change', mark: '~' },
  dropped: { word: 'Dropped', chip: 'ds-chip ds-chip--remove', mark: '-' },
  unverified: { word: 'Not confirmed', chip: 'ds-chip ds-chip--muted chip--unverified', mark: '?' },
}

export type VerdictCounts = Record<Verdict, number>

export function countVerdicts(comments: readonly ReviewComment[]): VerdictCounts {
  const counts: VerdictCounts = { kept: 0, moved: 0, dropped: 0, unverified: 0 }
  for (const c of comments) counts[c.verdict] += 1
  return counts
}

/** Comments the reader should act on: everything the checks and the second pass did not remove. */
export const isShown = (c: ReviewComment): boolean => c.verdict !== 'dropped'

export const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** How the second pass is described in one sentence, from the counts. */
export function verdictSentence(counts: VerdictCounts, verified: boolean): string {
  const total = counts.kept + counts.moved + counts.dropped + counts.unverified
  if (total === 0) return 'The first pass wrote no comments.'
  const parts = [
    `${counts.kept} kept`,
    `${counts.moved} moved to the line they are about`,
    `${counts.dropped} dropped`,
    ...(counts.unverified > 0 ? [`${counts.unverified} not confirmed`] : []),
  ]
  const lead = verified
    ? `The first pass wrote ${plural(total, 'comment', 'comments')}. The second pass read each one against the code:`
    : `The first pass wrote ${plural(total, 'comment', 'comments')}. The second pass did not finish, so:`
  return `${lead} ${parts.join(', ')}.`
}

/** Milliseconds of the model passes in a trace, by pass, for the readout hint. Null when that pass did not run. */
export function passTimes(trace: readonly TraceStep[]): { pass1: number | null; pass2: number | null } {
  const sum = (prefix: string) => {
    const rows = trace.filter((s) => s.name.startsWith(prefix) && s.status !== 'skipped')
    return rows.length > 0 ? rows.reduce((total, s) => total + s.ms, 0) : null
  }
  return { pass1: sum('Pass 1'), pass2: sum('Pass 2') }
}

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`
