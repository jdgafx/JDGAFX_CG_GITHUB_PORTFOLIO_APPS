import { addDays } from './format'
import type { Day, RunWindow, Rows, WindowDays } from './types'

/** The run cannot be set up: the message is the one the user sees. */
export class WindowError extends Error {}

const NAMES: Record<WindowDays, RunWindow['name']> = {
  30: 'the past month',
  90: 'the past three months',
  365: 'the past year',
}

/**
 * L, the window and the no-data days for a run.
 * 2 or more packages: a no-data day is a day before runDate on which every package is 0, and L is
 * the latest day before runDate that is not no-data. 1 package: no no-data days, and L is the
 * latest day before runDate with a value above 0.
 * `noData` lists every no-data day before runDate in the fetched rows (the unusual-day baseline
 * needs them from before the window too); callers that show them filter to the window.
 */
export function computeWindow(rowsByName: Record<string, Rows>, runDate: Day, days: WindowDays): RunWindow {
  const all = Object.values(rowsByName)
  const dayList = [...new Set(all.flatMap((r) => Object.keys(r)))].filter((d) => d < runDate).sort()
  const solo = all.length === 1
  const noData = solo ? [] : dayList.filter((d) => all.every((r) => (r[d] ?? 0) === 0))
  const noDataSet = new Set(noData)
  const usable = dayList.filter((d) => (solo ? (all[0]?.[d] ?? 0) > 0 : !noDataSet.has(d)))
  const L = usable[usable.length - 1]
  if (L === undefined) throw new WindowError('npm reports no downloads for these packages')
  if (L < addDays(runDate, -7)) throw new WindowError('npm has not published recent days yet')
  return {
    runDate,
    L,
    days,
    start: addDays(L, -(days - 1)),
    noData,
    past: [addDays(L, -29), L],
    before: [addDays(L, -59), addDays(L, -30)],
    name: NAMES[days],
  }
}
