import type { ReviewComment, TraceStep, Verdict } from '../types'

export const VERDICT_ORDER: Verdict[] = ['kept', 'moved', 'dropped', 'unverified']

/**
 * The word and the badge for each verdict. Verdicts are sans badges with a dot and a word; the +, ~ and - glyphs belong to
 * diff facts (added, changed and removed lines) and never to a verdict.
 */
export const VERDICT_WORD: Record<Verdict, { word: string; badge: string }> = {
  kept: { word: 'Kept', badge: 'ds-badge ds-badge--success' },
  moved: { word: 'Moved', badge: 'ds-badge ds-badge--success badge--moved' },
  dropped: { word: 'Dropped', badge: 'ds-badge' },
  unverified: { word: 'Not confirmed', badge: 'ds-badge ds-badge--warning badge--unconfirmed' },
}

/**
 * The badge text for one comment. It says what was checked, never that the claim is proven: the quote and its evidence were
 * found in the code, and the second pass judged the claim.
 */
export function verdictLabel(c: Pick<ReviewComment, 'verdict' | 'decidedBy' | 'fromLine' | 'where'>): string {
  const by = c.decidedBy === 'verifier' ? 'the second pass' : 'the checks'
  switch (c.verdict) {
    case 'kept':
      return 'Evidence checked, nothing found against it'
    case 'moved':
      return c.where ? 'Moved. Evidence checked, nothing found against it' : `Moved from line ${c.fromLine}. Evidence checked, nothing found against it`
    case 'dropped':
      return `Dropped by ${by}`
    default:
      return 'Not confirmed'
  }
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

/**
 * Milliseconds of the model passes in a trace, for the readout hint. Pass 1 adds its tries up. Pass 2 is two reads side by side,
 * so it is the span from the first read's start to the last read's end, not their sum. Null when that pass did not run.
 */
export function passTimes(trace: readonly TraceStep[]): { pass1: number | null; pass2: number | null } {
  const rows = (prefix: string) => trace.filter((s) => s.name.startsWith(prefix) && s.status !== 'skipped')
  const one = rows('Pass 1')
  const two = rows('Pass 2')
  const span = two.length === 0 ? null : Math.max(...two.map((s) => (s.at ?? 0) + s.ms)) - Math.min(...two.map((s) => s.at ?? 0))
  return { pass1: one.length === 0 ? null : one.reduce((total, s) => total + s.ms, 0), pass2: span }
}

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`
