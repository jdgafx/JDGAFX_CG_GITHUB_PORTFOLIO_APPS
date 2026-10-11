import { describe, expect, it } from 'vitest'
import { countVerdicts, isShown, passTimes, verdictLabel, verdictSentence } from '../../src/lib/verdicts'
import type { ReviewComment, TraceStep } from '../../src/types'

const c = (verdict: ReviewComment['verdict']): ReviewComment => ({ id: 1, line: 1, fromLine: 1, severity: 'info', message: 'm', suggestion: 's', verdict, decidedBy: 'none', reason: 'r', evidence: null, support: null, supportLine: null, code: '', where: null })
const step = (name: string, ms: number, status: TraceStep['status'] = 'ok'): TraceStep => ({ name, ms, status, detail: '' })

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
  it('adds a retry to its pass and ignores skipped rows', () => {
    const trace = [step('Check request', 3), step('Pass 1: review', 1200, 'failed'), step('Pass 1: review retry', 9000), step('Pass 2: verify', 0, 'skipped')]
    expect(passTimes(trace)).toEqual({ pass1: 10200, pass2: null })
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
