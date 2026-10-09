// Replies of the public APIs behind the tools, in the shape they were recorded
// (2026-10-09). Tests only: the app itself always fetches live.
import { jsonResponse, stubFetch, type FetchMock } from './helpers'

export const GEOCODE_LISBON = {
  results: [
    {
      id: 2267057,
      name: 'Lisbon',
      latitude: 38.72509,
      longitude: -9.1498,
      country_code: 'PT',
      admin1: 'Lisbon District',
      country: 'Portugal',
    },
  ],
}

export const FORECAST_LISBON = {
  latitude: 38.746044,
  longitude: -9.175565,
  utc_offset_seconds: 3600,
  timezone: 'Europe/Lisbon',
  timezone_abbreviation: 'GMT+1',
  current_units: {
    time: 'iso8601',
    interval: 'seconds',
    temperature_2m: '°C',
    apparent_temperature: '°C',
    relative_humidity_2m: '%',
    wind_speed_10m: 'km/h',
    weather_code: 'wmo code',
  },
  current: {
    time: '2026-10-09T06:00',
    interval: 900,
    temperature_2m: 17.6,
    apparent_temperature: 15,
    relative_humidity_2m: 47,
    wind_speed_10m: 10.9,
    weather_code: 0,
  },
  daily_units: { time: 'iso8601', temperature_2m_max: '°C', temperature_2m_min: '°C' },
  daily: { time: ['2026-10-09'], temperature_2m_max: [25.6], temperature_2m_min: [16.5] },
}

export const SUMMARY_ADA = {
  type: 'standard',
  title: 'Ada Lovelace',
  description: 'English mathematician (1815–1852)',
  extract:
    'Augusta Ada King, Countess of Lovelace was an English mathematician and writer, chiefly known for her work on Charles Babbage\'s proposed mechanical general-purpose computer, the Analytical Engine.',
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ada_Lovelace' } },
}

export const SEARCH_ADA = { pages: [{ id: 974, key: 'Ada_Lovelace', title: 'Ada Lovelace' }] }

// Answers by address, so a test states which upstream says what. An address no route
// matches fails the test loudly instead of reaching the network.
export function routeFetch(routes: Array<[match: string, reply: () => Response | Promise<Response>]>): FetchMock {
  return stubFetch(async input => {
    const url = String(input)
    const route = routes.find(([match]) => url.includes(match))
    if (!route) throw new Error(`unexpected request to ${url}`)
    return route[1]()
  })
}

export const weatherRoutes: Array<[string, () => Response]> = [
  ['geocoding-api.open-meteo.com', () => jsonResponse(GEOCODE_LISBON)],
  ['api.open-meteo.com/v1/forecast', () => jsonResponse(FORECAST_LISBON)],
]

export function callsTo(mock: FetchMock, host: string): string[] {
  return mock.mock.calls.map(call => String(call[0])).filter(url => url.includes(host))
}
