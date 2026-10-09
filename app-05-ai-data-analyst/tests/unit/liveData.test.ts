import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CITIES,
  DATASET_CHOICES,
  earthquakeUrl,
  lastTwelveMonths,
  weatherUrl,
} from '../../src/lib/liveData/catalog'
import { DatasetLoadError, loadDataset } from '../../src/lib/liveData/load'
import {
  DatasetFormatError,
  parseEarthquakeCsv,
  parseWeatherCsv,
  regionFromPlace,
} from '../../src/lib/liveData/parse'
import { OPEN_METEO_EXCERPT } from '../fixtures/openMeteo'
import { USGS_EXCERPT } from '../fixtures/usgs'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function formatReason(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    return error instanceof DatasetFormatError ? error.reason : 'other'
  }
  return undefined
}

describe('regionFromPlace', () => {
  it('takes the text after the last comma', () => {
    expect(regionFromPlace('2 km SSE of Nikiski, Alaska')).toBe('Alaska')
    expect(regionFromPlace('Izu Islands, Japan region')).toBe('Japan region')
    expect(regionFromPlace('10 km N of A, B, Chile')).toBe('Chile')
  })

  it('keeps the whole text when there is no comma', () => {
    expect(regionFromPlace('south of the Fiji Islands')).toBe('south of the Fiji Islands')
  })

  it('writes the two-letter codes USGS uses as names', () => {
    expect(regionFromPlace('9 km E of Borrego Springs, CA')).toBe('California')
    expect(regionFromPlace('12 km S of Mexicali, MX')).toBe('Mexico')
  })

  it('leaves a blank place blank', () => {
    expect(regionFromPlace('  ')).toBe('')
  })
})

describe('parseEarthquakeCsv', () => {
  const quakes = parseEarthquakeCsv(USGS_EXCERPT)

  it('reads every row of the recorded excerpt', () => {
    expect(quakes.rows).toHaveLength(16)
    expect(quakes.truncated).toBe(false)
  })

  it('adds a region column right after place', () => {
    const at = quakes.headers.indexOf('place')
    expect(quakes.headers[at + 1]).toBe('region')
    expect(quakes.headers).toHaveLength(23)
    expect(quakes.rows[0]).toMatchObject({ place: '2 km SSE of Nikiski, Alaska', region: 'Alaska', mag: '1.8' })
    expect(quakes.rows[3]?.region).toBe('California')
  })

  it('rejects a page that is not the feed', () => {
    expect(formatReason(() => parseEarthquakeCsv('<html><body>Service Unavailable</body></html>'))).toBe('malformed')
    expect(formatReason(() => parseEarthquakeCsv('a,b\n1,2'))).toBe('malformed')
  })

  it('reports a feed with a header and no rows as empty', () => {
    const header = USGS_EXCERPT.split('\n')[0] ?? ''
    expect(formatReason(() => parseEarthquakeCsv(header))).toBe('empty')
  })
})

describe('parseWeatherCsv', () => {
  const weather = parseWeatherCsv(OPEN_METEO_EXCERPT)

  it('drops the metadata block and renames the columns', () => {
    expect(weather.headers).toEqual(['date', 'month', 'temp_max_c', 'temp_min_c', 'precipitation_mm'])
    expect(weather.rows).toHaveLength(11)
    expect(weather.rows[0]).toEqual({
      date: '2025-10-08',
      month: '2025-10',
      temp_max_c: '21.8',
      temp_min_c: '14.5',
      precipitation_mm: '5.40',
    })
  })

  it('derives the month from each date', () => {
    expect(weather.rows.map((row) => row.month)).toEqual([
      ...Array<string>(7).fill('2025-10'),
      ...Array<string>(4).fill('2025-11'),
    ])
  })

  it('reads Windows line endings', () => {
    expect(parseWeatherCsv(OPEN_METEO_EXCERPT.replaceAll('\n', '\r\n')).rows).toHaveLength(11)
  })

  it('rejects a response with no data header', () => {
    expect(formatReason(() => parseWeatherCsv('{"error":true,"reason":"bad"}'))).toBe('malformed')
  })

  it('rejects a data header with the wrong columns', () => {
    expect(formatReason(() => parseWeatherCsv('time,rain\n2025-10-08,1'))).toBe('malformed')
  })

  it('reports a response with a header and no rows as empty', () => {
    const headerOnly = OPEN_METEO_EXCERPT.split('\n').slice(0, 4).join('\n')
    expect(formatReason(() => parseWeatherCsv(headerOnly))).toBe('empty')
  })
})

describe('catalog', () => {
  it('spans the 12 months ending yesterday', () => {
    expect(lastTwelveMonths(new Date('2026-10-09T15:00:00Z'))).toEqual({ start: '2025-10-09', end: '2026-10-08' })
  })

  it('crosses a year boundary and a leap day', () => {
    expect(lastTwelveMonths(new Date('2027-01-01T00:00:00Z'))).toEqual({ start: '2026-01-01', end: '2026-12-31' })
    expect(lastTwelveMonths(new Date('2028-03-01T00:00:00Z'))).toEqual({ start: '2027-03-01', end: '2028-02-29' })
  })

  it('builds the two USGS feed addresses', () => {
    expect(earthquakeUrl('quakes-week')).toBe(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.csv',
    )
    expect(earthquakeUrl('quakes-month')).toBe(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.csv',
    )
  })

  it('builds the Open-Meteo archive request for a city', () => {
    const sydney = CITIES.find((city) => city.id === 'sydney')!
    const url = new URL(weatherUrl(sydney, { start: '2025-10-09', end: '2026-10-08' }))
    expect(url.origin + url.pathname).toBe('https://archive-api.open-meteo.com/v1/archive')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '-33.87',
      longitude: '151.21',
      start_date: '2025-10-09',
      end_date: '2026-10-08',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
      timezone: 'auto',
      format: 'csv',
    })
  })

  it('offers example questions that name real columns', () => {
    const columns: Record<string, string[]> = {
      'quakes-week': parseEarthquakeCsv(USGS_EXCERPT).headers,
      'quakes-month': parseEarthquakeCsv(USGS_EXCERPT).headers,
      weather: parseWeatherCsv(OPEN_METEO_EXCERPT).headers,
    }
    const named: Record<string, string[]> = {
      'quakes-week': ['region', 'magType', 'type'],
      'quakes-month': ['region', 'magType', 'type', 'depth'],
      weather: ['month'],
    }
    for (const choice of DATASET_CHOICES) {
      expect(choice.questions.length).toBeGreaterThanOrEqual(3)
      for (const column of named[choice.id] ?? []) {
        expect(columns[choice.id]).toContain(column)
        expect(choice.questions.join(' ')).toContain(column)
      }
    }
  })
})

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

function stubFetch(impl: FetchFn) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

async function loadError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error as Error
  }
  throw new Error('expected the load to fail')
}

describe('loadDataset', () => {
  it('fetches the live USGS feed and describes its source', async () => {
    const fetchMock = stubFetch(async () => new Response(USGS_EXCERPT))
    const loaded = await loadDataset({ id: 'quakes-week', cityId: 'new-york' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(earthquakeUrl('quakes-week'))
    expect(loaded.data.rows).toHaveLength(16)
    expect(loaded.source).toMatchObject({
      kind: 'live',
      provider: 'USGS Earthquake Hazards Program',
      label: 'Earthquakes, past 7 days',
      url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.csv',
    })
    expect(loaded.source.fetchedAt).toBeInstanceOf(Date)
  })

  it('asks Open-Meteo for the chosen city over the last 12 months', async () => {
    const fetchMock = stubFetch(async () => new Response(OPEN_METEO_EXCERPT))
    const loaded = await loadDataset(
      { id: 'weather', cityId: 'tokyo' },
      { now: new Date('2026-10-09T10:00:00Z') },
    )
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(url.searchParams.get('latitude')).toBe('35.68')
    expect(url.searchParams.get('start_date')).toBe('2025-10-09')
    expect(url.searchParams.get('end_date')).toBe('2026-10-08')
    expect(loaded.data.rows).toHaveLength(11)
    expect(loaded.source.label).toBe('Daily weather, Tokyo')
    expect(loaded.source.detail).toBe('Daily highs, lows and rain from the Open-Meteo archive. Covers 2025-10-09 to 2026-10-08.')
  })

  it('reports a non-200 answer with its status', async () => {
    stubFetch(async () => new Response('down', { status: 503 }))
    const error = await loadError(loadDataset({ id: 'quakes-month', cityId: 'new-york' }))
    expect(error).toBeInstanceOf(DatasetLoadError)
    expect(error.message).toBe('USGS answered with status 503. Try again.')
  })

  it('tells the visitor to wait when Open-Meteo rate limits', async () => {
    stubFetch(async () => new Response('{"error":true}', { status: 429 }))
    const error = await loadError(loadDataset({ id: 'weather', cityId: 'london' }))
    expect(error.message).toBe(
      'Open-Meteo answered with status 429. It is rate limiting requests, so wait a minute. Try again.',
    )
  })

  it('reports a network failure as a connection problem', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    const error = await loadError(loadDataset({ id: 'quakes-week', cityId: 'new-york' }))
    expect(error.message).toBe('Could not reach USGS. Check your connection and try again.')
  })

  it('reports a timeout as the provider being slow', async () => {
    const expired = AbortSignal.abort(new DOMException('timed out', 'TimeoutError'))
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(expired)
    stubFetch(async (_url, init) => {
      throw init.signal?.reason
    })
    const error = await loadError(loadDataset({ id: 'weather', cityId: 'london' }))
    expect(error.message).toBe('Open-Meteo took too long to answer. Try again.')
  })

  it('passes a visitor abort through instead of showing an error', async () => {
    stubFetch(async (_url, init) => {
      throw init.signal?.reason
    })
    const controller = new AbortController()
    controller.abort()
    const error = await loadError(loadDataset({ id: 'quakes-week', cityId: 'new-york' }, { signal: controller.signal }))
    expect(error).not.toBeInstanceOf(DatasetLoadError)
    expect(error.name).toBe('AbortError')
  })

  it('reports an empty feed and a malformed page', async () => {
    const header = USGS_EXCERPT.split('\n')[0] ?? ''
    stubFetch(async () => new Response(header))
    expect((await loadError(loadDataset({ id: 'quakes-week', cityId: 'x' }))).message).toBe(
      'USGS returned no rows for this request. Try again later.',
    )
    stubFetch(async () => new Response('<html>maintenance</html>'))
    expect((await loadError(loadDataset({ id: 'quakes-week', cityId: 'x' }))).message).toBe(
      'USGS returned data in a shape this page cannot read. Try again later.',
    )
  })
})
