/**
 * The live datasets the page offers. Cities and feed paths are configuration; every row
 * comes from the provider at the moment the visitor picks the dataset.
 */

export type LiveDatasetId = 'quakes-week' | 'quakes-month' | 'weather'

export interface City {
  id: string
  label: string
  latitude: number
  longitude: number
}

export interface DatasetChoice {
  id: LiveDatasetId
  label: string
  /** One line on what the dataset holds, shown under the picker. */
  summary: string
  /** Example questions. Every column they name exists in the loaded dataset. */
  questions: string[]
}

export const DEFAULT_DATASET: LiveDatasetId = 'quakes-week'
export const DEFAULT_CITY = 'new-york'

export const DATASET_CHOICES: DatasetChoice[] = [
  {
    id: 'quakes-week',
    label: 'Earthquakes, past 7 days',
    summary: 'Every earthquake the USGS recorded worldwide in the past week, about 2,000 rows.',
    questions: [
      'Which region had the most earthquakes?',
      'Average magnitude by magType',
      'Count by type',
      'Strongest magnitude by region as a bar chart',
    ],
  },
  {
    id: 'quakes-month',
    label: 'Earthquakes, past 30 days',
    summary: 'The same USGS feed for the past month, about 10,000 rows and 2 MB.',
    questions: [
      'Which region had the most earthquakes?',
      'Average magnitude by magType',
      'Count by type',
      'Average depth by magType',
    ],
  },
  {
    id: 'weather',
    label: 'Daily weather, last 12 months',
    summary: 'Daily highs, lows and rain from the Open-Meteo archive.',
    questions: [
      'Average max temperature by month',
      'Total rain by month',
      'Lowest min temperature by month',
      'Count of days by month',
    ],
  },
]

export const CITIES: City[] = [
  { id: 'new-york', label: 'New York', latitude: 40.71, longitude: -74.01 },
  { id: 'london', label: 'London', latitude: 51.51, longitude: -0.13 },
  { id: 'tokyo', label: 'Tokyo', latitude: 35.68, longitude: 139.69 },
  { id: 'sydney', label: 'Sydney', latitude: -33.87, longitude: 151.21 },
  { id: 'mumbai', label: 'Mumbai', latitude: 19.08, longitude: 72.88 },
  { id: 'phoenix', label: 'Phoenix', latitude: 33.45, longitude: -112.07 },
  { id: 'reykjavik', label: 'Reykjavik', latitude: 64.15, longitude: -21.94 },
  { id: 'nairobi', label: 'Nairobi', latitude: -1.29, longitude: 36.82 },
]

const USGS_FEEDS = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary'
const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'

export function earthquakeUrl(id: 'quakes-week' | 'quakes-month'): string {
  return `${USGS_FEEDS}/${id === 'quakes-week' ? 'all_week' : 'all_month'}.csv`
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The 12 months ending yesterday, as ISO dates, read in UTC. For today = 2026-10-09 this is
 * 2025-10-09 to 2026-10-08.
 */
export function lastTwelveMonths(today: Date): { start: string; end: string } {
  const [y, m, d] = [today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()]
  const end = new Date(Date.UTC(y, m, d - 1))
  // The same date a year earlier, clamped for 29 February, then one day on: 365 or 366 days.
  const [ey, em, ed] = [end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()]
  const lastDayThen = new Date(Date.UTC(ey - 1, em + 1, 0)).getUTCDate()
  const start = new Date(Date.UTC(ey - 1, em, Math.min(ed, lastDayThen) + 1))
  return { start: isoDate(start), end: isoDate(end) }
}

export function weatherUrl(city: City, range: { start: string; end: string }): string {
  const url = new URL(OPEN_METEO_ARCHIVE)
  url.searchParams.set('latitude', String(city.latitude))
  url.searchParams.set('longitude', String(city.longitude))
  url.searchParams.set('start_date', range.start)
  url.searchParams.set('end_date', range.end)
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('format', 'csv')
  return url.toString()
}
