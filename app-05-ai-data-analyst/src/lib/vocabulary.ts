import type { Vocabulary } from '../types'

/** Raw column names and "rows": what answers say when nothing is known about the data. */
export const RAW_VOCABULARY: Vocabulary = { rowNoun: 'rows', labels: {}, units: {} }

/** A column in the dataset's own words. A column the vocabulary does not know keeps its name. */
export function labelFor(vocab: Vocabulary, field: string): string {
  return vocab.labels[field] ?? field
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
}
