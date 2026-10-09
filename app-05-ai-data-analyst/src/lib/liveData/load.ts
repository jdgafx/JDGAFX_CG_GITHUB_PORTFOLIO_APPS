import {
  CITIES,
  DATASET_CHOICES,
  earthquakeUrl,
  lastTwelveWholeMonths,
  weatherUrl,
  type LiveDatasetId,
} from './catalog'
import { DatasetFormatError, parseEarthquakeCsv, parseWeatherCsv } from './parse'
import { EARTHQUAKE_VOCABULARY, WEATHER_VOCABULARY } from '../vocabulary'
import type { DataSourceInfo, LoadedDataset, ParsedData, Vocabulary } from '../../types'

const FETCH_TIMEOUT_MS = 25_000

/** A load failure with a sentence that is safe to show. */
export class DatasetLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatasetLoadError'
  }
}

export interface LoadRequest {
  id: LiveDatasetId
  /** Only read for the weather dataset. */
  cityId: string
}

export interface LoadOptions {
  signal?: AbortSignal
  /** The clock, so the weather window can be tested. */
  now?: Date
}

async function fetchCsv(url: string, provider: string, signal: AbortSignal | undefined): Promise<string> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    if (!response.ok) {
      const hint = response.status === 429 ? ' It is rate limiting requests, so wait a minute.' : ''
      throw new DatasetLoadError(`${provider} answered with status ${response.status}.${hint} Try again.`)
    }
    return await response.text()
  } catch (error) {
    if (error instanceof DatasetLoadError) throw error
    // A visitor who switched dataset is not an error; the caller drops the result.
    if (signal?.aborted) throw error
    if (timeout.aborted) throw new DatasetLoadError(`${provider} took too long to answer. Try again.`)
    throw new DatasetLoadError(`Could not reach ${provider}. Check your connection and try again.`)
  }
}

interface Resolved {
  url: string
  /** The short name used in error sentences. */
  provider: string
  parse: (text: string) => ParsedData
  source: Omit<DataSourceInfo, 'kind' | 'url' | 'fetchedAt'>
  vocab: Vocabulary
}

function resolve(request: LoadRequest, now: Date): Resolved {
  const choice = DATASET_CHOICES.find((item) => item.id === request.id)
  if (!choice) throw new DatasetLoadError('That dataset is not available.')

  if (request.id === 'weather') {
    const city = CITIES.find((item) => item.id === request.cityId) ?? CITIES[0]
    if (!city) throw new DatasetLoadError('That dataset is not available.')
    const range = lastTwelveWholeMonths(now)
    return {
      url: weatherUrl(city, range),
      provider: 'Open-Meteo',
      parse: parseWeatherCsv,
      source: {
        provider: 'Open-Meteo',
        label: `Daily weather, ${city.label}`,
        detail: `${choice.summary} Covers ${range.start} to ${range.end}.`,
      },
      vocab: WEATHER_VOCABULARY,
    }
  }
  return {
    url: earthquakeUrl(request.id),
    provider: 'USGS',
    parse: parseEarthquakeCsv,
    source: { provider: 'USGS Earthquake Hazards Program', label: choice.label, detail: choice.summary },
    vocab: EARTHQUAKE_VOCABULARY,
  }
}

/** Fetches a live dataset from its public API and parses it. Every row is read in the browser. */
export async function loadDataset(request: LoadRequest, options: LoadOptions = {}): Promise<LoadedDataset> {
  const { url, provider, parse, source, vocab } = resolve(request, options.now ?? new Date())
  const text = await fetchCsv(url, provider, options.signal)

  let data: ParsedData
  try {
    data = parse(text)
  } catch (error) {
    if (!(error instanceof DatasetFormatError)) throw error
    throw new DatasetLoadError(
      error.reason === 'empty'
        ? `${provider} returned no rows for this request. Try again later.`
        : `${provider} returned data in a shape this page cannot read. Try again later.`,
    )
  }

  return { data, vocab, source: { ...source, kind: 'live', url, fetchedAt: new Date() } }
}
