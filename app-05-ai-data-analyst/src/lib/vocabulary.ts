import type { Vocabulary } from '../types'

/** Raw column names and "rows": what answers say when nothing is known about the data. */
export const RAW_VOCABULARY: Vocabulary = { rowNoun: 'rows', labels: {}, units: {} }

/** A column in the dataset's own words. A column the vocabulary does not know keeps its name. */
export function labelFor(vocab: Vocabulary, field: string): string {
  return vocab.labels[field] ?? field
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTH_LABEL = /^(\d{4})-(0[1-9]|1[0-2])$/

/** A group label as people say it: "2026-07" is "July 2026" when the dataset's months are real months. */
export function shownLabel(vocab: Vocabulary, label: string): string {
  const match = vocab.months ? MONTH_LABEL.exec(label) : null
  return match ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : label
}

/** The short axis form of a month label: "Jul", with the year on a second line at the first month and each January. */
export function axisMonth(label: string, first: boolean): { top: string; year: string | null } | null {
  const match = MONTH_LABEL.exec(label)
  if (!match) return null
  const month = Number(match[2])
  return { top: (MONTHS[month - 1] ?? '').slice(0, 3), year: first || month === 1 ? (match[1] ?? null) : null }
}

/** A number with its unit, when the column has one: "12.4 mm". */
export function withUnit(vocab: Vocabulary, field: string, text: string): string {
  const unit = vocab.units[field]
  return unit ? `${text} ${unit}` : text
}

/** USGS earthquake feed: what its terse column names mean. */
export const EARTHQUAKE_VOCABULARY: Vocabulary = {
  rowNoun: 'earthquakes',
  labels: {
    time: 'time',
    mag: 'magnitude',
    magType: 'magnitude type',
    depth: 'depth',
    place: 'place',
    region: 'region',
    type: 'event type',
    nst: 'stations',
    gap: 'azimuthal gap',
    dmin: 'distance to nearest station',
    rms: 'RMS residual',
    net: 'network',
    status: 'review status',
    horizontalError: 'horizontal error',
    depthError: 'depth error',
    magError: 'magnitude error',
    magNst: 'magnitude stations',
    locationSource: 'location source',
    magSource: 'magnitude source',
  },
  units: { depth: 'km', depthError: 'km', horizontalError: 'km', dmin: 'degrees', gap: 'degrees' },
}

/** Open-Meteo daily archive after the page renames its columns. */
export const WEATHER_VOCABULARY: Vocabulary = {
  rowNoun: 'days',
  labels: {
    date: 'date',
    month: 'month',
    temp_max_c: 'daily high temperature',
    temp_min_c: 'daily low temperature',
    precipitation_mm: 'rain',
  },
  units: { temp_max_c: '°C', temp_min_c: '°C', precipitation_mm: 'mm' },
  months: true,
}
