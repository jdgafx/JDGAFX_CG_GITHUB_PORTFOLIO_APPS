import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResultCard } from '../../src/components/ResultCard'
import type { ReviewComment, ReviewResult, RunPhase } from '../../src/types'

const comment = (over: Partial<ReviewComment>): ReviewComment => ({
  id: 1, line: 2, fromLine: 2, severity: 'critical', message: 'Dividing by zero raises ZeroDivisionError.', suggestion: 'Check b first.', verdict: 'unverified', decidedBy: 'none',
  reason: 'Waiting for the second pass: this comment has passed the checks only, and has not been read against the code yet.', evidence: null, support: null, supportLine: null, claimKind: null, code: '    return a / b', where: null, ...over,
})
const result = (comments: ReviewComment[], verified: boolean): ReviewResult => ({ comments, lineCount: 2, truncated: false, verified, malformed: 0, mode: 'file', pr: null })

const html = (phase: RunPhase, res: ReviewResult | null, checking: boolean) =>
  renderToStaticMarkup(
    createElement(ResultCard, {
      phase, error: null, result: res, checking, hasSteps: true, filters: { critical: true, warning: true, info: true }, highlightedLine: null, copied: false, stale: false,
      onToggleFilter: () => {}, onShowLine: () => {}, contextOf: () => null, hrefOf: () => null, emptyBody: '', onRetry: () => {}, onCopy: () => {}, sortComments: (c) => c,
    }),
  )

describe('the result while the reads are still running', () => {
  const waiting = result([comment({}), comment({ id: 2, line: 1, verdict: 'dropped', decidedBy: 'check', reason: 'Cited a blank line.' })], false)

  it('shows the first pass comments under a "Checking each comment" state, with none of them confirmed', () => {
    const out = html('running', waiting, true)
    expect(out).toContain('Checking each comment')
    expect(out).toContain('Dividing by zero raises ZeroDivisionError.')
    expect(out).toContain('Not confirmed')
    expect(out).not.toMatch(/>Kept</)
    expect(out).not.toContain('Review checked by a second pass')
    expect(out).toContain('First-pass comments, being checked (1)')
  })

  it('offers no Copy review, which would call the list verified, and does not say the second pass failed', () => {
    const out = html('running', waiting, true)
    expect(out).not.toContain('Copy review')
    expect(out).not.toContain('The second pass did not finish')
  })

  it('shows the loading card, not comments, while pass 1 itself is still running', () => {
    const out = html('running', null, false)
    expect(out).toContain('Reviewing')
    expect(out).toContain('The first comments appear in about 15 to 25 seconds')
    expect(out).not.toContain('Dividing by zero')
  })
})

describe('the result when the reads did not finish', () => {
  it('keeps the visible note and lists the comments as not confirmed, never as checked', () => {
    const out = html('done', result([comment({ reason: 'The second pass did not finish, so only the deterministic checks ran on this comment.' })], false), false)
    expect(out).toContain('The second pass did not finish, so the surviving comments are shown as not confirmed.')
    expect(out).toContain('Review partly checked')
    expect(out).not.toContain('Checking each comment')
    expect(out).not.toContain('Review checked by a second pass')
  })

  it('shows the checked view and its Copy button once the reads are back', () => {
    const out = html('done', result([comment({ verdict: 'kept', decidedBy: 'verifier', reason: 'return a / b has no guard.', evidence: 'return a / b' })], true), false)
    expect(out).toContain('Review checked by a second pass')
    expect(out).toContain('Copy review')
    expect(out).not.toContain('Checking each comment')
  })
})

describe('ranges that were not reviewed', () => {
  const kept = comment({ verdict: 'kept', decidedBy: 'verifier', reason: 'return a / b has no guard.', evidence: 'return a / b' })
  const withGap = (mode: 'file' | 'pr', label: string): ReviewResult => ({ ...result([kept], true), mode, notReviewed: [{ from: 201, to: 400, label, reason: 'The AI provider did not answer in time.' }] })

  it('says in words which lines were not reviewed and why, never silently', () => {
    const out = html('done', withGap('file', 'lines 201-400'), false)
    expect(out).toContain('Lines 201-400 were not reviewed: The AI provider did not answer in time. No comment was written for them. Run the review again to cover them.')
  })

  it('names the files of a pull request', () => {
    expect(html('done', withGap('pr', 'b.go, c.go'), false)).toContain('The changes in b.go, c.go were not reviewed: ')
  })

  it('never calls a review with a range missing "checked by a second pass", even when every comment it has is confirmed', () => {
    const out = html('done', withGap('file', 'lines 201-400'), false)
    expect(out).toContain('Review partly checked')
    expect(out).not.toContain('Review checked by a second pass')
  })

  it('shows the note while the reads are still running too', () => {
    expect(html('running', { ...withGap('file', 'lines 201-400'), verified: false, comments: [comment({})] }, true)).toContain('Lines 201-400 were not reviewed')
  })

  it('says nothing when the whole input was reviewed', () => {
    expect(html('done', result([kept], true), false)).not.toContain('not reviewed')
    expect(html('done', { ...result([kept], true), notReviewed: [] }, false)).not.toContain('not reviewed')
  })
})
