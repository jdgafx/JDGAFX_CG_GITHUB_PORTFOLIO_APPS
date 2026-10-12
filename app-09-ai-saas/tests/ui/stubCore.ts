import type { Day, PackageFacts, RunWindow, UnusualRow, WindowDays } from '../../shared/types'
import type { Core, Judged } from '../../src/lib/useRun'

/**
 * Stubs of the WP1 functions by their spec section 9 signatures. They keep the UI tests independent of WP1:
 * the window is fixed, the facts are small, and every claim is judged `checked` unless the test says otherwise.
 */
export function stubWindow(runDate: string, days: WindowDays): RunWindow {
  return {
    runDate,
    L: '2026-10-11',
    days,
    start: days === 30 ? '2026-09-12' : days === 90 ? '2026-07-14' : '2025-10-12',
    noData: [],
    past: ['2026-09-12', '2026-10-11'],
    before: ['2026-08-13', '2026-09-11'],
    name: days === 30 ? 'the past month' : days === 90 ? 'the past three months' : 'the past year',
  }
}

export function stubFacts(name: string, unusualCount = 8): PackageFacts {
  return {
    name,
    aggregates: {
      windowTotal: 5_000_000n,
      last30Total: 800_000n,
      peakDay: '2026-10-01',
      peakValue: 39_000,
      growth: { S1: 800_000n, n1: 30, S0: 700_000n, n0: 30, computable: true },
    },
    unusual: Array.from({ length: unusualCount }, (_, i) => ({
      day: `2026-09-${String(10 + i).padStart(2, '0')}`,
      value: 1000 + i * 100,
      median: 500,
      kind: 'spike' as const,
      release: 'none' as const,
    })),
    possibleGaps: [],
    notAssessed: [],
  }
}

export function makeStubCore(overrides: Partial<Core> = {}): Core {
  return {
    computeWindow: (_rows, runDate, days) => stubWindow(runDate, days),
    computeFacts: (rows) => Object.keys(rows).map(name => stubFacts(name)),
    judge: (segments): Judged[] => segments.map(seg => ({ seg, verdict: seg.t === 'text' ? 'neutral' : 'checked', rendered: seg.t === 'text' ? seg.s : 'x' })),
    topUnusual: (rows: UnusualRow[], n = 6) =>
      [...rows]
        .sort((a, b) => b.value / b.median - a.value / a.median)
        .slice(0, n)
        .sort((a, b) => (a.day < b.day ? -1 : 1)),
    buildPastRows: (rows, window) => {
      const out: Array<[Day, number, 'no-data' | 'possible-gap' | null]> = []
      for (let i = 0; i < 30; i++) {
        const day = new Date(Date.parse(`${window.past[0]}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)
        out.push([day, rows[day] ?? 0, null])
      }
      return out
    },
    figureNumbers: paragraphs =>
      paragraphs.flatMap((segs, paragraph) =>
        segs.flatMap((seg, segment) =>
          seg.t === 'claim' && !['peak_day', 'unusual_day', 'day'].includes(seg.kind) && /\d/.test(seg.value) ? [{ paragraph, segment }] : [],
        ),
      ),
    fillCode: paragraph => paragraph,
    validateShape: () => ({ ok: true }),
    ...overrides,
  }
}
