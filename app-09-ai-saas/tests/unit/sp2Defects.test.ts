import { describe, expect, it } from 'vitest'
import { checkClaims, describeClaimCheck } from '../../netlify/shared/claimCheck'
import { parseClaims } from '../../netlify/shared/claims'
import { spikePrompt } from '../../netlify/shared/evidence'
import { checkFigures } from '../../netlify/shared/figureCheck'
import type { Summary } from '../../netlify/shared/contract'
import { figureResult } from '../../src/components/AnswerCard'
import type { TraceStep } from '../../src/lib/api'
import r13 from '../fixtures/sp2-r1-3.json'
import r31 from '../fixtures/sp2-r3-1.json'
import r32 from '../fixtures/sp2-r3-2.json'

// Saved answers from the SP2 run of 2026-10-11: the summary the browser sent and the explanation the model wrote.
const summaryOf = (fixture: { summary: unknown }) => fixture.summary as Summary

describe('D1: every plain number is checked or shown as unchecked, and the badge counts the unchecked', () => {
  it('shows a plain number the checks did not judge as unchecked, and a number of days that is the window as checked', () => {
    // "Prisma and typeorm had 1 and 2 found, respectively": no check reads these, so they are shown as unchecked.
    const check = checkClaims(r31.explanation, [], summaryOf(r31))
    expect(check.unchecked).toContain('2')
    // "the two 15-day halves" is the summary's half window (30 days, halved): checked, not unchecked.
    expect(check.unchecked).not.toContain('15')
  })

  it('counts unchecked figures in the badge total, so it never reads as all matching', () => {
    const check = checkClaims(r31.explanation, [], summaryOf(r31))
    const badge = describeClaimCheck(check)
    expect(check.unchecked.length).toBeGreaterThan(0)
    expect(badge).toMatch(new RegExp(`^${check.matched} of ${check.checked + check.unchecked.length} `))
    expect(badge).not.toMatch(/^(\d+) of \1 /)
  })
})

describe('D1 badge on the page: the total counts the unchecked figures', () => {
  it('reads 26 of 27 figures when one is unchecked, never 26 of 26', () => {
    const step: TraceStep = { name: 'Check figures', status: 'ok', ms: 0, detail: '', check: { checked: 26, matched: 26, rejected: [], unchecked: ['16'] } }
    expect(figureResult(step).text).toBe('26 of 27 figures match the evidence')
  })
})

describe('D1b: a stated total of unusual days is checked against the sum of the per-package counts', () => {
  it('rejects "16 unusual days" when the detector found 8 (1 + 5 + 2)', () => {
    expect(checkClaims(r31.explanation, [], summaryOf(r31)).rejected.map((r) => r.figure)).toContain('16')
  })
})

describe('D2a: a malformed claims array is read entry by entry, so one bad entry does not discard the rest', () => {
  it('keeps the well-formed entries when one has an unknown kind', () => {
    const claims = parseClaims('[{"q":"4.4 times","k":"multiple","p":["zod","react"],"m":"total"},{"q":"x","k":"mystery","p":[]},{"q":"40.3%","k":"share_pct","p":["zod"]}]')
    expect(claims?.map((c) => c.q)).toEqual(['4.4 times', '40.3%'])
  })

  it('reads a quote that the model broke across a line, with the line break read as a space', () => {
    const claims = parseClaims('[{"q":"4,812,017 downloads against a usual\n3,159,025","k":"spike_downloads","p":["drizzle-orm"],"d":"2026-09-28"}]')
    expect(claims?.map((c) => c.q)).toEqual(['4,812,017 downloads against a usual 3,159,025'])
  })

  it('reads an entry followed by a trailing comma', () => {
    const claims = parseClaims('[{"q":"+52%","k":"spike_pct","p":["drizzle-orm"],"d":"2026-09-28",},{"q":"40.3%","k":"share_pct","p":["zod"]}]')
    expect(claims).toHaveLength(2)
  })

  it('checks the saved answer on the structured path: the +52% of 2026-09-28 is matched, nothing is rejected', () => {
    // Synthesized claims for the saved answer of r3-2 (the raw claims array was not saved): one of each defect above.
    const raw = [
      '[',
      '{"q":"5 unusual days","k":"spike_count","p":["drizzle-orm"]},',
      '{"q":"+52%","k":"spike_pct","p":["drizzle-orm"],"d":"2026-09-28",},',
      '{"q":"4,812,017 downloads against a usual\n3,159,025","k":"spike_downloads","p":["drizzle-orm"],"d":"2026-09-28"},',
      '{"q":"51.9%","k":"share_pct","p":null},',
      '{"q":"3 days before","k":"lag","p":[]}',
      ']',
    ].join('\n')
    const claims = parseClaims(raw)
    expect(claims).toHaveLength(4)
    const check = checkClaims(r32.explanation, claims ?? [], summaryOf(r32))
    expect(check.rejected).toEqual([])
    expect(check.unchecked.some((figure) => figure.includes('52%'))).toBe(false)
    expect(check.matched).toBeGreaterThanOrEqual(2)
  })
})

describe('D2b: a figure that two metrics fit is unchecked, not reported as not in the summary', () => {
  it('leaves "+52%" in the saved spike sentence unchecked: the share 51.9% and the spike 52.33% both round to 52', () => {
    expect(checkFigures(r32.explanation, summaryOf(r32)).unmatched).not.toContain('52%')
  })
})

describe('D2c: a figure the evidence holds is not rejected because its claim names the wrong kind', () => {
  it('does not reject 63,094,459, the zod spike download of 2026-09-29, when the claim calls it a total', () => {
    // Synthesized claim: the saved r1-3 answer is correct about this figure; only the claim's kind is wrong.
    const check = checkClaims(r13.explanation, [{ q: '63,094,459 downloads', k: 'total', p: ['zod'] }], summaryOf(r13))
    expect(check.rejected).toEqual([])
    expect(check.unchecked).toContain('63,094,459')
  })
})

describe('D2 percentages: a figure is read as written, from the unrounded spike percentage', () => {
  it('matches "+52.3%" for 4,812,017 against a usual 3,159,025 (52.33%, not the stored 52)', () => {
    const check = checkFigures('Drizzle-orm ran +52.3% above its usual level on the spike day.', summaryOf(r32))
    expect(check.unmatched).toEqual([])
    expect(check.matched).toBe(1)
  })
})

describe('D4: the prompt does not tell the model that release history is unavailable in general', () => {
  it('says release history is unavailable only for a spike line that says so', () => {
    const prompt = spikePrompt(summaryOf(r31))
    expect(prompt).not.toContain('Where release history is unavailable, say so')
    expect(prompt).toMatch(/release history is unavailable only (for|when|where)/)
  })
})
