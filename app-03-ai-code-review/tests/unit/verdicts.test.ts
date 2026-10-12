import { describe, expect, it } from 'vitest'
import { countVerdicts, isShown, passTimes, verdictLabel, verdictSentence } from '../../src/lib/verdicts'
import type { ReviewComment, TraceStep } from '../../src/types'

const c = (verdict: ReviewComment['verdict']): ReviewComment => ({ id: 1, line: 1, fromLine: 1, severity: 'info', message: 'm', suggestion: 's', verdict, decidedBy: 'none', reason: 'r', evidence: null, support: null, supportLine: null, code: '', where: null })
const step = (name: string, ms: number, status: TraceStep['status'] = 'ok', at?: number): TraceStep => ({ name, ms, status, detail: '', ...(at === undefined ? {} : { at }) })

describe('countVerdicts and isShown', () => {
  const list = [c('kept'), c('kept'), c('moved'), c('dropped'), c('unverified')]
  it('counts each verdict', () => expect(countVerdicts(list)).toEqual({ kept: 2, moved: 1, dropped: 1, unverified: 1 }))
  it('shows everything except dropped comments', () => expect(list.filter(isShown)).toHaveLength(4))
})

describe('verdictSentence', () => {
  it('states the first-pass total and what became of it, with the live mux run 6 figures', () => {
    expect(verdictSentence({ kept: 6, moved: 4, dropped: 7, unverified: 0 }, true)).toBe(
      'The first pass wrote 17 comments. The second pass read each one against the code: 6 kept, 4 moved to the line they are about, 7 dropped.',
    )
  })

  it('says plainly when the second pass did not finish and lists the unconfirmed', () => {
    expect(verdictSentence({ kept: 0, moved: 0, dropped: 5, unverified: 12 }, false)).toContain('The second pass did not finish')
    expect(verdictSentence({ kept: 0, moved: 0, dropped: 5, unverified: 12 }, false)).toContain('12 not confirmed')
  })

  it('handles a first pass that wrote nothing', () => {
    expect(verdictSentence({ kept: 0, moved: 0, dropped: 0, unverified: 0 }, true)).toBe('The first pass wrote no comments.')
  })
})

describe('passTimes', () => {
  it('covers a retry, which follows its failed try, and ignores skipped rows', () => {
    const trace = [step('Check request', 3, 'ok', 0), step('Pass 1: review', 1200, 'failed', 3), step('Pass 1: review retry', 9000, 'ok', 1203), step('Pass 2: verify', 0, 'skipped', 10203)]
    expect(passTimes(trace)).toEqual({ pass1: 10200, pass2: null })
  })

  it('is the wall time of shards that ran side by side, not their sum (live r3-a: 41.5 s shown for a 30.4 s run)', () => {
    // The four pass 1 rows of r3-a as the server reported them: 14.0, 8.3, 9.2 and 9.9 s, all started within 54 ms.
    const trace = [
      step('Pass 1: review (lines 1-170)', 14045, 'ok', 3),
      step('Pass 1: review (lines 458-608)', 8347, 'ok', 54),
      step('Pass 1: review (lines 305-457)', 9220, 'ok', 2),
      step('Pass 1: review (lines 171-304)', 9899, 'ok', 17),
    ]
    expect(passTimes(trace).pass1).toBe(14048 - 2)
  })
})

describe('verdictLabel: a claim of kind other is shown as checked by its quote only', () => {
  const base = { decidedBy: 'verifier' as const, fromLine: 4, where: null }
  it('says the claim itself is not checked for kind other, and keeps the plain wording for a typed claim', () => {
    expect(verdictLabel({ ...base, verdict: 'kept', claimKind: 'other' })).toBe('Quoted code found, the claim itself is not checked')
    expect(verdictLabel({ ...base, verdict: 'moved', claimKind: 'other' })).toBe('Moved from line 4. Quoted code found, the claim itself is not checked')
    expect(verdictLabel({ ...base, verdict: 'kept', claimKind: 'shadows' })).toBe('Evidence checked, nothing found against it')
    expect(verdictLabel({ ...base, verdict: 'kept' })).toBe('Evidence checked, nothing found against it')
  })
})
