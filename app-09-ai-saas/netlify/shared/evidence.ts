import {
  MAX_PACKAGES,
  MAX_RELEASES_PER_SPIKE,
  MAX_SPIKES_PER_PACKAGE,
  RELEASE_LAG_DAYS,
  type ReleaseKind,
  type ReleaseRef,
  type Summary,
  type SpikeEvidence,
} from './contract'

/** The spike evidence: its request validation, its place in the prompt, and the date and version part of the answer check. */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/
const KINDS: readonly ReleaseKind[] = ['major', 'minor', 'patch']

type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

function whole(source: Record<string, unknown>, field: string, path: string, min: number, max: number): Checked<number> {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isInteger(value)) return { ok: false, error: `${path}.${field} must be a whole number` }
  if (value < min || value > max) return { ok: false, error: `${path}.${field} is out of range` }
  return { ok: true, value }
}

function readRelease(raw: unknown, path: string, spikeDate: string): Checked<ReleaseRef> {
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` }
  if (typeof raw.version !== 'string' || !VERSION.test(raw.version)) return { ok: false, error: `${path}.version must be x.y.z` }
  if (!isDate(raw.date)) return { ok: false, error: `${path}.date must be a date as YYYY-MM-DD` }
  const lag = (Date.parse(`${spikeDate}T00:00:00Z`) - Date.parse(`${raw.date}T00:00:00Z`)) / 86_400_000
  if (lag < 0 || lag > RELEASE_LAG_DAYS) return { ok: false, error: `${path}.date must be within ${RELEASE_LAG_DAYS} days before the spike` }
  if (!KINDS.includes(raw.kind as ReleaseKind)) return { ok: false, error: `${path}.kind must be major, minor or patch` }
  return { ok: true, value: { version: raw.version, date: raw.date, kind: raw.kind as ReleaseKind } }
}

function readSpike(raw: unknown, index: number, names: ReadonlySet<string>, window: { start: string; end: string }): Checked<SpikeEvidence> {
  const path = `summary.spikes[${index}]`
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` }
  if (typeof raw.name !== 'string' || !names.has(raw.name)) return { ok: false, error: `${path}.name must be one of the summary's packages` }
  if (!isDate(raw.date) || raw.date < window.start || raw.date > window.end) {
    return { ok: false, error: `${path}.date must be a date inside the window` }
  }
  const downloads = whole(raw, 'downloads', path, 1, 1e13)
  if (!downloads.ok) return downloads
  const baseline = whole(raw, 'baseline', path, 1, 1e13)
  if (!baseline.ok) return baseline
  const sizePct = whole(raw, 'sizePct', path, 0, 1e8)
  if (!sizePct.ok) return sizePct
  const moreReleases = whole(raw, 'moreReleases', path, 0, 10_000)
  if (!moreReleases.ok) return moreReleases
  if (typeof raw.releasesKnown !== 'boolean') return { ok: false, error: `${path}.releasesKnown must be true or false` }
  if (!Array.isArray(raw.releases) || raw.releases.length > MAX_RELEASES_PER_SPIKE) {
    return { ok: false, error: `${path}.releases needs 0 to ${MAX_RELEASES_PER_SPIKE} entries` }
  }
  const releases: ReleaseRef[] = []
  for (const [i, entry] of raw.releases.entries()) {
    const release = readRelease(entry, `${path}.releases[${i}]`, raw.date)
    if (!release.ok) return release
    releases.push(release.value)
  }
  return {
    ok: true,
    value: {
      name: raw.name,
      date: raw.date,
      downloads: downloads.value,
      baseline: baseline.value,
      sizePct: sizePct.value,
      releases,
      moreReleases: moreReleases.value,
      releasesKnown: raw.releasesKnown,
    },
  }
}

/** Checks the optional spike list of a request. Absent is valid. Unknown fields are dropped. */
export function parseSpikes(
  raw: unknown,
  names: ReadonlySet<string>,
  window: { start: string; end: string },
): Checked<SpikeEvidence[] | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (!Array.isArray(raw) || raw.length > MAX_PACKAGES * MAX_SPIKES_PER_PACKAGE) {
    return { ok: false, error: `summary.spikes needs at most ${MAX_PACKAGES * MAX_SPIKES_PER_PACKAGE} entries` }
  }
  const spikes: SpikeEvidence[] = []
  for (const [index, entry] of raw.entries()) {
    const spike = readSpike(entry, index, names, window)
    if (!spike.ok) return spike
    spikes.push(spike.value)
  }
  return { ok: true, value: spikes }
}

/** Checks the optional per-package count of unusual days found. Absent is valid. */
export function parseSpikeCounts(raw: unknown, names: ReadonlySet<string>): Checked<Record<string, number> | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (!isRecord(raw)) return { ok: false, error: 'summary.spikeCounts must be an object' }
  const counts: Record<string, number> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (!names.has(name)) return { ok: false, error: 'summary.spikeCounts names a package that is not in the summary' }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 400) return { ok: false, error: `summary.spikeCounts.${name} must be a whole number from 0 to 400` }
    counts[name] = value
  }
  return { ok: true, value: counts }
}

function spikeLine(s: SpikeEvidence): string {
  const head = `- ${s.name} on ${s.date}: ${s.downloads.toLocaleString('en-US')} downloads, +${s.sizePct}% against the usual ${s.baseline.toLocaleString('en-US')} for that weekday`
  if (!s.releasesKnown) return `${head}; release history unavailable`
  if (s.releases.length === 0) return `${head}; no stable release in the ${RELEASE_LAG_DAYS} days before`
  const list = s.releases.map((r) => `${r.version} (${r.kind}, ${r.date})`).join(', ')
  return `${head}; stable releases in the ${RELEASE_LAG_DAYS} days up to that day: ${list}${s.moreReleases > 0 ? `, and ${s.moreReleases} more` : ''}`
}

/** The prompt section for the spike evidence. Empty when the request carries none. */
export function spikePrompt(s: Summary): string {
  if (s.spikes === undefined) return ''
  const rules = `Spike rules: explain the unusual days in a short paragraph that starts with "Spikes:" and comes after the numbered insights. Use only the spike lines above. A day, a version or a percentage may be written only if it appears there. Say a release came out "just before" a spike rather than that it caused it, because a release near a spike is a coincidence in time that the data cannot prove. Where a spike has no release listed, say no release was found nearby and do not guess a reason. Where release history is unavailable, say so. Do not write version numbers in a shortened form. Keep the whole answer under 400 words and the Spikes paragraph under 120 words: name the two or three largest spikes and any that follow a release, and give a count for the rest instead of listing them. Do not state a ratio between two changes or growth rates.`
  if (s.spikes.length === 0) {
    return `\nUnusual days: none. No day in the window ran far above the usual level for its weekday. Add one sentence starting with "Spikes:" saying so.\n`
  }
  const found = s.spikeCounts
  const capNote = found
    ? `The detector found ${s.packages.map((p) => `${found[p.name] ?? 0} for ${p.name}`).join(', ')}. Each package's strongest ${MAX_SPIKES_PER_PACKAGE} are listed, so the lines below may be fewer than what was found: say "found" for the counts above and "listed" for the lines.\n`
    : ''
  return `\nUnusual days (a day far above the usual level for its weekday):\n${capNote}${s.spikes.map(spikeLine).join('\n')}\n\n${rules}\n`
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const ISO_IN_TEXT = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g
const WORDED_DATE =
  /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?![\d:])/g
const VERSION_IN_TEXT = /(?<![\w.])v?(\d+\.\d+\.\d+)(?!\d|\.\d)/g

export interface EvidenceCheck {
  checked: number
  matched: number
  unmatched: string[]
}

/** A date or a version written in the text, where it starts and what it says. */
export interface Written {
  index: number
  text: string
  kind: 'date' | 'version'
  /** For a date: month-day as MM-DD, and the year when the text gives one. */
  monthDay?: string
  year?: string
  /** For a version: x.y.z. */
  version?: string
}

/** Every date (2026-09-28, September 28, Sep 28, 2026) and every version written as x.y.z in `text`, in order. */
export function writtenDatesAndVersions(text: string): Written[] {
  const found: Written[] = []
  for (const m of text.matchAll(ISO_IN_TEXT)) found.push({ index: m.index ?? 0, text: m[0], kind: 'date', monthDay: `${m[2]}-${m[3]}`, year: m[1] })
  for (const m of text.matchAll(WORDED_DATE)) {
    const month = String(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1).padStart(2, '0')
    found.push({ index: m.index ?? 0, text: m[0].trim(), kind: 'date', monthDay: `${month}-${m[2].padStart(2, '0')}`, year: m[3] })
  }
  for (const m of text.matchAll(VERSION_IN_TEXT)) found.push({ index: m.index ?? 0, text: m[0], kind: 'version', version: m[1] })
  return found.sort((a, b) => a.index - b.index)
}

/**
 * Whether something written is in the evidence. With `name`, only that package's evidence counts: its spike days, the
 * dates of its releases and the window's own dates for a date, its releases for a version.
 */
export function writtenIsKnown(item: Written, s: Summary, name?: string): boolean {
  const spikes = (s.spikes ?? []).filter((spike) => name === undefined || spike.name === name)
  if (item.kind === 'version') return spikes.some((spike) => spike.releases.some((r) => r.version === item.version))
  const dates = new Set([s.startDate, s.endDate])
  for (const spike of spikes) {
    dates.add(spike.date)
    for (const release of spike.releases) dates.add(release.date)
  }
  return [...dates].some((d) => d.slice(5) === item.monthDay && (item.year === undefined || d.slice(0, 4) === item.year))
}

/**
 * Checks the dates and versions an answer writes against the spike evidence. A date matches when the evidence
 * holds it (month and day, and the year when the answer gives one). A version written as x.y.z matches when a
 * listed release has it. Versions in shortened form, such as "v19", are not read. Does nothing when the request
 * carried no spike evidence. `covered` skips what a structured claim has already checked.
 */
export function checkEvidence(text: string, s: Summary, covered: (index: number) => boolean = () => false): EvidenceCheck {
  const result: EvidenceCheck = { checked: 0, matched: 0, unmatched: [] }
  if (s.spikes === undefined) return result
  for (const item of writtenDatesAndVersions(text)) {
    if (covered(item.index)) continue
    result.checked += 1
    if (writtenIsKnown(item, s)) result.matched += 1
    else result.unmatched.push(item.text)
  }
  return result
}
