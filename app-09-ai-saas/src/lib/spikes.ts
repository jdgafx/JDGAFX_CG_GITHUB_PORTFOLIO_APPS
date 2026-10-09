import {
  MAX_RELEASES_PER_SPIKE,
  MAX_SPIKES_PER_PACKAGE,
  RELEASE_LAG_DAYS,
  type ReleaseRef,
  type SpikeEvidence,
} from '../../netlify/shared/contract'
import type { DownloadWindow } from './analytics'
import { addDays, daysBetween } from './dates'
import type { Release } from './releases'

/**
 * Spike detection, in one paragraph. Downloads move by ratio, so each day is judged on the natural log of its
 * count. A weekday has its own level (weekends run far lower), so a day is compared only with the same weekday in
 * the weeks before it: the median of up to BASELINE_WEEKS earlier same-weekday values. The robust score is
 * (ln(day) - median) / (1.4826 * MAD), where MAD is the median absolute deviation of those same values and 1.4826
 * makes it comparable to a standard deviation. The scale never drops below SCALE_FLOOR (8 percent), so a package
 * whose weekday counts barely vary is not flagged for a 2 percent wobble. A day is a spike at score SPIKE_Z or
 * more. Only upward days are reported: the large downward days are holidays and outages, which no release explains.
 */
export const SPIKE_Z = 3.5
export const BASELINE_WEEKS = 8
export const MIN_BASELINE = 4
export const SCALE_FLOOR = 0.08
const MAD_TO_SIGMA = 1.4826

export interface Spike {
  date: string
  downloads: number
  /** Median of the same weekday over the weeks before, rounded to whole downloads. */
  baseline: number
  /** Downloads against the baseline in percent, rounded to a whole number. */
  sizePct: number
  /** The robust score, rounded to one decimal. */
  z: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Upward spikes in one package's daily series, oldest first. `values` is aligned with `dates`; null (an
 * unreported day) and zero are neither judged nor used in a baseline. Days with fewer than MIN_BASELINE earlier
 * same-weekday values cannot be judged.
 */
export function detectSpikes(dates: string[], values: (number | null)[]): Spike[] {
  const byDate = new Map(dates.map((date, i) => [date, values[i]]))
  const spikes: Spike[] = []
  dates.forEach((date, i) => {
    const value = values[i]
    if (value === null || value <= 0) return
    const earlier: number[] = []
    for (let back = 1; back <= BASELINE_WEEKS; back++) {
      const prior = byDate.get(addDays(date, -7 * back))
      if (prior !== undefined && prior !== null && prior > 0) earlier.push(Math.log(prior))
    }
    if (earlier.length < MIN_BASELINE) return
    const centre = median(earlier)
    const scale = Math.max(MAD_TO_SIGMA * median(earlier.map((v) => Math.abs(v - centre))), SCALE_FLOOR)
    const z = (Math.log(value) - centre) / scale
    if (z < SPIKE_Z) return
    const baseline = Math.exp(centre)
    spikes.push({
      date,
      downloads: value,
      baseline: Math.round(baseline),
      sizePct: Math.round((value / baseline - 1) * 100),
      z: Math.round(z * 10) / 10,
    })
  })
  return spikes
}

/** The releases published on `date` or up to RELEASE_LAG_DAYS before it, newest first. */
export function releasesBefore(date: string, releases: Release[]): Release[] {
  return releases
    .filter((r) => {
      const lag = daysBetween(r.date, date)
      return lag >= 0 && lag <= RELEASE_LAG_DAYS
    })
    .sort((a, b) => (a.date === b.date ? compareVersions(b.version, a.version) : a.date < b.date ? 1 : -1))
}

/** Orders x.y.z versions by number. Used only to keep same-day releases in a stable, newest-first order. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

const toRef = ({ version, date, kind }: Release): ReleaseRef => ({ version, date, kind })

/**
 * The evidence the page lists and the model reads. For each package, its strongest spikes (by score) inside the
 * displayed window, each with the stable releases that came out on that day or the three days before. `releases`
 * maps a package to its release list, or to null when the registry could not be read for it.
 * Detection runs on the whole fetched history so a short window still has a baseline. Result is oldest first.
 */
export function buildSpikeEvidence(
  history: DownloadWindow,
  windowStart: string,
  releases: ReadonlyMap<string, Release[] | null>,
): SpikeEvidence[] {
  const evidence: SpikeEvidence[] = []
  for (const series of history.series) {
    const list = releases.get(series.name) ?? null
    const top = detectSpikes(history.dates, series.values)
      .filter((spike) => spike.date >= windowStart)
      .sort((a, b) => b.z - a.z || (a.date < b.date ? -1 : 1))
      .slice(0, MAX_SPIKES_PER_PACKAGE)
    for (const spike of top) {
      const matched = list === null ? [] : releasesBefore(spike.date, list)
      evidence.push({
        name: series.name,
        date: spike.date,
        downloads: spike.downloads,
        baseline: spike.baseline,
        sizePct: spike.sizePct,
        releases: matched.slice(0, MAX_RELEASES_PER_SPIKE).map(toRef),
        moreReleases: Math.max(0, matched.length - MAX_RELEASES_PER_SPIKE),
        releasesKnown: list !== null,
      })
    }
  }
  return evidence.sort((a, b) => (a.date === b.date ? (a.name < b.name ? -1 : 1) : a.date < b.date ? -1 : 1))
}
