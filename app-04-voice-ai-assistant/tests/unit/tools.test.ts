import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_DEFINITIONS, runTool } from '../../netlify/shared/tools'
import { headerOf, jsonResponse, stubFetch } from '../helpers'
import {
  FORECAST_LISBON,
  GEOCODE_LISBON,
  SEARCH_ADA,
  SUMMARY_ADA,
  callsTo,
  routeFetch,
  weatherRoutes,
} from '../tool-fixtures'

const FAR = () => Date.now() + 25_000

describe('tool definitions', () => {
  it('offers weather(place) and wikipedia_summary(topic), both required', () => {
    expect(TOOL_DEFINITIONS.map(tool => [tool.function.name, tool.function.parameters.required])).toEqual([
      ['weather', ['place']],
      ['wikipedia_summary', ['topic']],
    ])
  })
})

describe('weather tool', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('geocodes the place, then reads the forecast, with units taken from the reply', async () => {
    const fetchMock = routeFetch(weatherRoutes)

    const out = await runTool('weather', '{"place":"Lisbon"}', FAR())

    expect(out.ok).toBe(true)
    expect(out.call).toBe('weather("Lisbon")')
    expect(out.content).toBe(
      'Weather for Lisbon, Lisbon District, Portugal (local time 2026-10-09T06:00). Now: 17.6 °C, clear sky. ' +
        "Feels like 15 °C. Humidity 47 %. Wind 10.9 km/h. Today's high 25.6 °C low 16.5 °C. Source: Open-Meteo.",
    )
    expect(out.detail).toBe('Lisbon, Lisbon District, Portugal: 17.6 °C, clear sky')

    const geocode = new URL(callsTo(fetchMock, 'geocoding-api')[0])
    expect(geocode.searchParams.get('name')).toBe('Lisbon')
    expect(geocode.searchParams.get('count')).toBe('1')
    const forecast = new URL(callsTo(fetchMock, 'v1/forecast')[0])
    expect(forecast.searchParams.get('latitude')).toBe('38.72509')
    expect(forecast.searchParams.get('longitude')).toBe('-9.1498')
    expect(out.source).toBe(forecast.toString())
  })

  it('reports another unit exactly as the forecast gives it', async () => {
    const imperial = {
      ...FORECAST_LISBON,
      current_units: { ...FORECAST_LISBON.current_units, temperature_2m: '°F', wind_speed_10m: 'mph' },
    }
    routeFetch([
      ['geocoding-api', () => jsonResponse(GEOCODE_LISBON)],
      ['v1/forecast', () => jsonResponse(imperial)],
    ])

    const out = await runTool('weather', '{"place":"Lisbon"}', FAR())

    expect(out.content).toContain('Now: 17.6 °F, clear sky.')
    expect(out.content).toContain('Wind 10.9 mph.')
  })

  it('applies a country after the comma to the geocoder results', async () => {
    const paris = {
      results: [
        { name: 'Paris', latitude: 33.66, longitude: -95.55, admin1: 'Texas', country: 'United States', country_code: 'US' },
        { name: 'Paris', latitude: 48.85341, longitude: 2.3488, admin1: 'Île-de-France', country: 'France', country_code: 'FR' },
      ],
    }
    const fetchMock = routeFetch([
      ['geocoding-api', () => jsonResponse(paris)],
      ['v1/forecast', () => jsonResponse(FORECAST_LISBON)],
    ])

    const out = await runTool('weather', '{"place":"Paris, France"}', FAR())

    const geocode = new URL(callsTo(fetchMock, 'geocoding-api')[0])
    expect(geocode.searchParams.get('name')).toBe('Paris')
    expect(geocode.searchParams.get('count')).toBe('10')
    expect(new URL(callsTo(fetchMock, 'v1/forecast')[0]).searchParams.get('latitude')).toBe('48.85341')
    expect(out.content).toContain('Weather for Paris, Île-de-France, France')
  })

  it('says no place was found, with no forecast call and no source, when the geocoder has no results', async () => {
    const fetchMock = routeFetch([['geocoding-api', () => jsonResponse({ generationtime_ms: 0.4 })]])

    const out = await runTool('weather', '{"place":"Zzyzx Qqq"}', FAR())

    expect(out.content).toBe('No place called "Zzyzx Qqq" was found by the geocoding service, so there is no weather to report.')
    expect(out.source).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('tells the model the service did not answer, and gives no number, on an upstream error', async () => {
    routeFetch([
      ['geocoding-api', () => jsonResponse(GEOCODE_LISBON)],
      ['v1/forecast', () => new Response('boom', { status: 500 })],
    ])

    const out = await runTool('weather', '{"place":"Lisbon"}', FAR())

    expect(out.ok).toBe(false)
    expect(out.content).toBe(
      'The weather service did not answer. No data is available, so tell the user that instead of guessing.',
    )
    expect(out.content).not.toMatch(/\d/)
    expect(out.source).toBeUndefined()
  })

  it('stops waiting at the time left in the run, and says the service did not answer in time', async () => {
    stubFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const started = Date.now()

    const out = await runTool('weather', '{"place":"Lisbon"}', Date.now() + 60)

    expect(Date.now() - started).toBeLessThan(1_000)
    expect(out.ok).toBe(false)
    expect(out.content).toMatch(/^The weather service did not answer in time\./)
    expect(out.detail).toBe('No reply before the 3 second limit')
  })

  it('gives every upstream request a timeout signal', async () => {
    const fetchMock = routeFetch(weatherRoutes)

    await runTool('weather', '{"place":"Lisbon"}', FAR())

    for (const call of fetchMock.mock.calls) expect(call[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('makes no request when the run budget is already spent', async () => {
    const fetchMock = routeFetch(weatherRoutes)

    const out = await runTool('weather', '{"place":"Lisbon"}', Date.now() - 1)

    expect(out.ok).toBe(false)
    expect(out.detail).toBe('No time left in the run budget')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['arguments that are not JSON', 'not json', 'The tool arguments were not valid JSON.'],
    ['no place', '{}', 'The tool needs a "place" text argument.'],
    ['a place that is not text', '{"place":5}', 'The tool needs a "place" text argument.'],
    ['a blank place', '{"place":"   "}', 'The "place" argument must be 1 to 80 characters of plain text.'],
    ['a place over 80 characters', `{"place":"${'x'.repeat(81)}"}`, 'The "place" argument must be 1 to 80 characters of plain text.'],
    ['a control character', '{"place":"Lis\\u0000bon"}', 'The "place" argument must be 1 to 80 characters of plain text.'],
  ])('refuses %s without any request', async (_label, args, reason) => {
    const fetchMock = routeFetch(weatherRoutes)

    const out = await runTool('weather', args, FAR())

    expect(out.ok).toBe(false)
    expect(out.detail).toBe(reason)
    expect(out.content).toBe(`${reason} Nothing was looked up.`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a tool that is not offered', async () => {
    const fetchMock = routeFetch(weatherRoutes)

    const out = await runTool('send_email', '{"to":"x"}', FAR())

    expect(out.ok).toBe(false)
    expect(out.content).toMatch(/^That tool does not exist\./)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('wikipedia_summary tool', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the title, the extract and the article link, and identifies itself to Wikimedia', async () => {
    const fetchMock = routeFetch([['/page/summary/Ada_Lovelace', () => jsonResponse(SUMMARY_ADA)]])

    const out = await runTool('wikipedia_summary', '{"topic":"Ada Lovelace"}', FAR())

    expect(out.ok).toBe(true)
    expect(out.call).toBe('wikipedia_summary("Ada Lovelace")')
    expect(out.source).toBe('https://en.wikipedia.org/wiki/Ada_Lovelace')
    expect(out.detail).toBe('Ada Lovelace')
    expect(out.content).toBe(
      `Ada Lovelace (English mathematician (1815–1852)): ${SUMMARY_ADA.extract} Source: https://en.wikipedia.org/wiki/Ada_Lovelace`,
    )
    expect(headerOf(fetchMock, 0, 'user-agent')).toMatch(/^VoxAI-demo\//)
  })

  it('cuts a long extract to 600 characters', async () => {
    routeFetch([['/page/summary/', () => jsonResponse({ ...SUMMARY_ADA, extract: 'word '.repeat(400) })]])

    const out = await runTool('wikipedia_summary', '{"topic":"Ada Lovelace"}', FAR())

    const body = out.content.split(': ')[1].replace(' Source', '')
    expect(body.length).toBeLessThanOrEqual(600 + 20)
    expect(out.content).toContain('…')
  })

  it('finds the article by search when the exact title does not exist', async () => {
    const fetchMock = routeFetch([
      ['/page/summary/Countess_of_Lovelace', () => new Response('{}', { status: 404 })],
      ['/w/rest.php/v1/search/page', () => jsonResponse(SEARCH_ADA)],
      ['/page/summary/Ada_Lovelace', () => jsonResponse(SUMMARY_ADA)],
    ])

    const out = await runTool('wikipedia_summary', '{"topic":"Countess of Lovelace"}', FAR())

    // The first lookup uses the title with underscores for spaces: it 404s, so search runs.
    expect(callsTo(fetchMock, 'wikipedia.org').map(url => new URL(url).pathname)).toEqual([
      '/api/rest_v1/page/summary/Countess_of_Lovelace',
      '/w/rest.php/v1/search/page',
      '/api/rest_v1/page/summary/Ada_Lovelace',
    ])
    expect(out.source).toBe('https://en.wikipedia.org/wiki/Ada_Lovelace')
  })

  it('says there is no article when neither the title nor the search matches', async () => {
    routeFetch([
      ['/page/summary/', () => new Response('{}', { status: 404 })],
      ['/search/page', () => jsonResponse({ pages: [] })],
    ])

    const out = await runTool('wikipedia_summary', '{"topic":"Qxzv Wplk"}', FAR())

    expect(out.ok).toBe(true)
    expect(out.content).toBe('Wikipedia has no article matching "Qxzv Wplk", so there is nothing to summarise.')
    expect(out.source).toBeUndefined()
  })

  it('flags a disambiguation page instead of presenting it as an answer', async () => {
    routeFetch([
      [
        '/page/summary/',
        () => jsonResponse({ ...SUMMARY_ADA, type: 'disambiguation', title: 'Mercury', extract: 'Mercury most commonly refers to:' }),
      ],
    ])

    const out = await runTool('wikipedia_summary', '{"topic":"Mercury"}', FAR())

    expect(out.detail).toBe('Mercury (disambiguation page)')
    expect(out.content).toContain('This is a disambiguation page')
  })

  it('treats a reply with no extract as no summary', async () => {
    routeFetch([['/page/summary/', () => jsonResponse({ type: 'standard', title: 'Ada Lovelace' })]])

    const out = await runTool('wikipedia_summary', '{"topic":"Ada Lovelace"}', FAR())

    expect(out.content).toBe('Wikipedia returned no readable summary for "Ada Lovelace".')
    expect(out.source).toBeUndefined()
  })

  it('tells the model Wikipedia did not answer on an upstream error', async () => {
    routeFetch([['/page/summary/', () => new Response('down', { status: 503 })]])

    const out = await runTool('wikipedia_summary', '{"topic":"Ada Lovelace"}', FAR())

    expect(out.ok).toBe(false)
    expect(out.content).toBe('Wikipedia did not answer. No data is available, so tell the user that instead of guessing.')
  })

  it('refuses a missing topic without any request', async () => {
    const fetchMock = routeFetch([])

    const out = await runTool('wikipedia_summary', '{"place":"Ada"}', FAR())

    expect(out.content).toBe('The tool needs a "topic" text argument. Nothing was looked up.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
