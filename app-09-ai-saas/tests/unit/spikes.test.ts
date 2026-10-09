import { describe, expect, it } from 'vitest'
import { MAX_SPIKES_PER_PACKAGE } from '../../netlify/shared/contract'
import type { DownloadWindow } from '../../src/lib/analytics'
import { addDays } from '../../src/lib/dates'
import type { Release } from '../../src/lib/releases'
import { buildSpikeEvidence, detectSpikes, releasesBefore } from '../../src/lib/spikes'

// 2026-01-05 is a Monday. A steady week: Mon..Sun.
const WEEK = [1000, 1100, 1200, 1100, 1000, 400, 300]
const START = '2026-01-05'

/** `weeks` steady weeks from START, with some days replaced. */
function series(weeks: number, overrides: Record<number, number | null> = {}) {
  const dates = Array.from({ length: weeks * 7 }, (_, i) => addDays(START, i))
  const values = dates.map((_, i) => (i in overrides ? overrides[i] : WEEK[i % 7]))
  return { dates, values }
}

describe('detectSpikes', () => {
  it('flags a Monday at double its usual level, with exact size and score', () => {
    const { dates, values } = series(10, { 63: 2000 })
    // Eight earlier Mondays all at 1000: baseline 1000, spread 0 so the 8% floor sets the scale. ln(2) / 0.08 = 8.66.
    expect(detectSpikes(dates, values)).toEqual([{ date: '2026-03-09', downloads: 2000, baseline: 1000, sizePct: 100, z: 8.7 }])
  })

  it('compares a day only with the same weekday, so a normal weekend is not a spike', () => {
    const { dates, values } = series(10)
    expect(detectSpikes(dates, values)).toEqual([])
  })

  it('sits right on the threshold: a score of 3.56 is flagged and 3.28 is not', () => {
    // ln(1.33) / 0.08 = 3.565; ln(1.3) / 0.08 = 3.280.
    const { dates, values } = series(10, { 56: 1330, 49: 1300 })
    expect(detectSpikes(dates, values)).toEqual([{ date: '2026-03-02', downloads: 1330, baseline: 1000, sizePct: 33, z: 3.6 }])
  })

  it('measures a Tuesday against Tuesdays', () => {
    // Baseline 1100. ln(1500 / 1100) / 0.08 = 3.88.
    const { dates, values } = series(10, { 64: 1500 })
    expect(detectSpikes(dates, values)).toEqual([{ date: '2026-03-10', downloads: 1500, baseline: 1100, sizePct: 36, z: 3.9 }])
  })

  it('cannot judge a day with fewer than four earlier same-weekday values', () => {
    // Index 21 has three earlier Mondays, index 28 has four.
    const { dates, values } = series(5, { 21: 5000, 28: 5000 })
    expect(detectSpikes(dates, values).map((s) => s.date)).toEqual(['2026-02-02'])
  })

  it('leaves unreported days out of the baseline, and needs four left', () => {
    const four = series(6, { 7: null, 14: null, 21: null, 35: 2000 }) // Mondays at 0 (idx 0) ... idx 35 has 0, 28 left: 2 values
    expect(detectSpikes(four.dates, four.values)).toEqual([])
    const enough = series(6, { 7: null, 35: 2000 }) // idx 0, 14, 21, 28 remain: four values
    expect(detectSpikes(enough.dates, enough.values)).toEqual([{ date: '2026-02-09', downloads: 2000, baseline: 1000, sizePct: 100, z: 8.7 }])
  })

  it('never flags a null or zero day', () => {
    const { dates, values } = series(10, { 63: 0, 56: null })
    expect(detectSpikes(dates, values)).toEqual([])
  })

  it('does not flag a drop, however large', () => {
    const { dates, values } = series(10, { 63: 100 })
    expect(detectSpikes(dates, values)).toEqual([])
  })

  it('uses the spread of the weekday when it varies: a noisy package needs a bigger jump', () => {
    // Earlier Mondays alternate 800 and 1250: median ln is between them, MAD is wide, so 1600 is not unusual.
    const noisy = series(10, { 0: 800, 7: 1250, 14: 800, 21: 1250, 28: 800, 35: 1250, 42: 800, 49: 1250, 56: 800, 63: 1600 })
    expect(detectSpikes(noisy.dates, noisy.values).map((s) => s.date)).not.toContain('2026-03-09')
  })
})

describe('releasesBefore', () => {
  const releases: Release[] = [
    { version: '2.0.0', date: '2026-03-11', kind: 'major' }, // after the spike
    { version: '1.9.1', date: '2026-03-10', kind: 'patch' },
    { version: '1.9.0', date: '2026-03-10', kind: 'minor' },
    { version: '1.8.0', date: '2026-03-07', kind: 'minor' }, // three days before
    { version: '1.7.0', date: '2026-03-06', kind: 'minor' }, // four days before
  ]

  it('takes the spike day and the three days before it, newest first, and nothing after', () => {
    expect(releasesBefore('2026-03-10', releases).map((r) => r.version)).toEqual(['1.9.1', '1.9.0', '1.8.0'])
  })

  it('is empty when nothing came out nearby', () => {
    expect(releasesBefore('2026-04-20', releases)).toEqual([])
  })
})

describe('buildSpikeEvidence', () => {
  const full = series(14, { 70: 2000, 91: 2000 }) // 2026-03-16 and 2026-04-06, both Mondays
  const history: DownloadWindow = {
    start: full.dates[0],
    end: full.dates[full.dates.length - 1],
    dates: full.dates,
    gapDates: [],
    lagDays: 0,
    series: [{ key: 'p0', name: 'react', values: full.values }],
  }
  const list: Release[] = [
    { version: '19.1.0', date: '2026-04-04', kind: 'minor' },
    { version: '19.0.1', date: '2026-04-06', kind: 'patch' },
  ]

  it('keeps only spikes inside the window and matches releases to each', () => {
    const evidence = buildSpikeEvidence(history, '2026-04-01', new Map([['react', list]]))
    expect(evidence).toEqual([
      {
        name: 'react',
        date: '2026-04-06',
        downloads: 2000,
        baseline: 1000,
        sizePct: 100,
        releases: [
          { version: '19.0.1', date: '2026-04-06', kind: 'patch' },
          { version: '19.1.0', date: '2026-04-04', kind: 'minor' },
        ],
        moreReleases: 0,
        releasesKnown: true,
      },
    ])
  })

  it('says the releases are unknown when the registry could not be read, not that there were none', () => {
    const evidence = buildSpikeEvidence(history, '2026-04-01', new Map([['react', null]]))
    expect(evidence[0]).toMatchObject({ releases: [], releasesKnown: false })
    const empty = buildSpikeEvidence(history, '2026-04-01', new Map([['react', []]]))
    expect(empty[0]).toMatchObject({ releases: [], releasesKnown: true })
  })

  it('lists five releases and counts the rest', () => {
    const many: Release[] = Array.from({ length: 7 }, (_, i) => ({ version: `1.0.${i + 1}`, date: '2026-04-06', kind: 'patch' as const }))
    const [spike] = buildSpikeEvidence(history, '2026-04-01', new Map([['react', many]]))
    expect(spike.releases.map((r) => r.version)).toEqual(['1.0.7', '1.0.6', '1.0.5', '1.0.4', '1.0.3'])
    expect(spike.moreReleases).toBe(2)
  })

  it('keeps the strongest spikes per package and returns them oldest first', () => {
    // Twelve spikes eight days apart (so each lands on a different weekday), growing from 1.5 to 2.6 times the usual.
    const overrides: Record<number, number> = {}
    for (let k = 0; k < 12; k++) overrides[70 + 8 * k] = Math.round(WEEK[(70 + 8 * k) % 7] * (1.5 + 0.1 * k))
    const big = series(24, overrides)
    const win: DownloadWindow = { ...history, dates: big.dates, end: big.dates[big.dates.length - 1], series: [{ key: 'p0', name: 'react', values: big.values }] }
    const evidence = buildSpikeEvidence(win, START, new Map())
    expect(evidence).toHaveLength(MAX_SPIKES_PER_PACKAGE)
    expect(evidence.map((s) => s.date)).toEqual([...evidence.map((s) => s.date)].sort())
    // The four weakest (1.5 to 1.8 times) are the ones dropped.
    expect(Math.min(...evidence.map((s) => s.sizePct))).toBeGreaterThanOrEqual(90)
  })
})
