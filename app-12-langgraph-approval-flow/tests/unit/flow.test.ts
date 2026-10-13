import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { JUDGE_COUNT, JUDGE_MIN_SCORE } from '../../netlify/shared/duplicate-rank'
import { DuplicatesCard, JUDGE_NOTE } from '../../src/components/DuplicatesCard'
import { Readout } from '../../src/components/Readout'
import { discardReplayedRead, singleFlight, stepClockMs } from '../../src/lib/flow'
import { emptyRun } from '../../src/lib/run-state'
import type { DuplicateReport, TraceRow } from '../../src/types'

describe('discardReplayedRead', () => {
  it('reads the replayed reply, keeps nothing of it, and loads the live list afterwards', async () => {
    const order: string[] = []
    await discardReplayedRead(
      async () => {
        order.push('read')
        return { threads: [{ id: 'recorded' }] }
      },
      () => order.push('live'),
    )
    expect(order).toEqual(['read', 'live'])
  })

  it('still loads the live list when the replayed read fails', async () => {
    let live = 0
    await discardReplayedRead(() => Promise.reject(new Error('Failed to fetch')), () => (live += 1))
    expect(live).toBe(1)
  })
})

describe('singleFlight', () => {
  it('starts one run for two calls in the same tick, and again once it has settled', async () => {
    let started = 0
    let release: () => void = () => undefined
    const press = singleFlight(() => {
      started += 1
      return new Promise<void>((resolve) => (release = resolve))
    })
    const first = press()
    void press()
    expect(started).toBe(1)
    release()
    await first
    const again = press()
    expect(started).toBe(2)
    release()
    await again
  })

  it('lets the next press through after a run that threw', async () => {
    let started = 0
    const press = singleFlight(async () => {
      started += 1
      throw new Error('boom')
    })
    await press().catch(() => undefined)
    await press().catch(() => undefined)
    expect(started).toBe(2)
  })
})

const row = (node: TraceRow['node'], ms: number): TraceRow => ({ node, status: 'ok', ms, detail: '' })

describe('the step clock', () => {
  it('adds the running step to the steps that ended, as the run reports them', () => {
    expect(stepClockMs([1000, 2500], 300)).toBe(3800)
    expect(stepClockMs([], -5)).toBe(0)
  })

  it('reads the reported time of the ended steps while running, not the time since the press', () => {
    const run = { ...emptyRun(), trace: [row('classify', 4000), row('duplicates', 1000)] }
    const html = renderToStaticMarkup(createElement(Readout, { run, phase: 'running' }))
    expect(html).toContain('5.00 s')
  })
})

describe('the duplicate card names who the model judges', () => {
  const report: DuplicateReport = { status: 'none', message: 'No candidates.', terms: [], candidates: [], confirmed: null }

  it('says up to the server limit and the thresholds a candidate needs, not a fixed "top three"', () => {
    expect(JUDGE_NOTE).toContain(`up to ${JUDGE_COUNT}`)
    expect(JUDGE_NOTE).toContain(String(JUDGE_MIN_SCORE))
    const html = renderToStaticMarkup(createElement(DuplicatesCard, { report, searching: false }))
    expect(html).toContain('up to 3 of the best matches')
    expect(html).not.toContain('top three')
  })
})
