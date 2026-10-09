// The two live tools the chat model may call: weather (Open-Meteo) and a Wikipedia
// summary. Both run on the server, inside the run's time budget. Every failure comes
// back as plain text for the model to relay, never as a value it could mistake for data.

const TOOL_TIMEOUT_MS = 3_000
const MAX_ARGUMENT_CHARS = 80
const MAX_EXTRACT_CHARS = 600
const MAX_RESULT_CHARS = 1_000

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const WIKI_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary/'
const WIKI_SEARCH_URL = 'https://en.wikipedia.org/w/rest.php/v1/search/page'

// Wikimedia asks API clients to say who they are.
const USER_AGENT = 'VoxAI-demo/1.0 (https://jdgafx-app-04-voice-ai-assistant.netlify.app; portfolio demo)'

export type ToolName = 'weather' | 'wikipedia_summary'

// What the model is offered. Sent with every chat request.
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'weather',
      description:
        'Current weather and today\'s high and low for a named place, from Open-Meteo. ' +
        'Use it whenever the user asks about weather or temperature somewhere.',
      parameters: {
        type: 'object',
        properties: { place: { type: 'string', description: 'A city or town, optionally with a country, e.g. "Lisbon" or "Paris, France".' } },
        required: ['place'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wikipedia_summary',
      description:
        'The introduction of an English Wikipedia article. Use it for factual questions about a person, ' +
        'place, event or concept.',
      parameters: {
        type: 'object',
        properties: { topic: { type: 'string', description: 'The article title or subject, e.g. "Ada Lovelace".' } },
        required: ['topic'],
        additionalProperties: false,
      },
    },
  },
] as const

// One finished tool call: the text for the model, and what the run card shows.
export interface ToolOutcome {
  ok: boolean
  // The tool and its argument, e.g. weather("Lisbon").
  call: string
  // What the model reads back. On failure this is a plain sentence, never a value.
  content: string
  // One line for the run card.
  detail: string
  // The page or API request the data came from. Absent when nothing was fetched.
  source?: string
  ms: number
}

class ToolFailure extends Error {}
class NotFound extends Error {}

const WMO_CODES: Record<number, string> = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'light freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'light freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light rain showers', 81: 'rain showers', 82: 'violent rain showers', 85: 'light snow showers', 86: 'snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with heavy hail',
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

// A tool argument is model output, so it is checked like any other input.
function readArgument(raw: string, key: 'place' | 'topic'): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ToolFailure('The tool arguments were not valid JSON.')
  }
  const value = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)[key] : undefined
  if (typeof value !== 'string') throw new ToolFailure(`The tool needs a "${key}" text argument.`)
  const text = value.replace(/\s+/g, ' ').trim()
  // eslint-disable-next-line no-control-regex
  if (!text || text.length > MAX_ARGUMENT_CHARS || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new ToolFailure(`The "${key}" argument must be 1 to ${MAX_ARGUMENT_CHARS} characters of plain text.`)
  }
  return text
}

async function getJson(url: string, signal: AbortSignal, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { accept: 'application/json', ...headers } })
  if (res.status === 404) throw new NotFound()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function measure(value: unknown, unit: unknown, fixed = 1): string | undefined {
  const n = num(value)
  if (n === undefined) return undefined
  return `${Number(n.toFixed(fixed))} ${typeof unit === 'string' ? unit : ''}`.trim()
}

interface Place {
  name: string
  label: string
  latitude: number
  longitude: number
}

// "Paris, France" searches for Paris and prefers the result in France. The geocoder
// matches the name only, so a trailing qualifier is applied here.
async function geocode(place: string, signal: AbortSignal): Promise<Place | null> {
  const [name, ...rest] = place.split(',')
  const qualifier = rest.join(',').trim().toLowerCase()
  const url = new URL(GEOCODING_URL)
  url.search = new URLSearchParams({ name: name.trim(), count: qualifier ? '10' : '1', language: 'en', format: 'json' }).toString()
  const results = asRecord(await getJson(url.toString(), signal)).results
  if (!Array.isArray(results)) return null
  const candidates = results.map(asRecord)
  const match =
    (qualifier
      ? candidates.find(r =>
          [r.country, r.country_code, r.admin1].some(v => typeof v === 'string' && v.toLowerCase() === qualifier),
        )
      : undefined) ?? candidates[0]
  const latitude = num(match?.latitude)
  const longitude = num(match?.longitude)
  const found = text(match?.name)
  if (!match || latitude === undefined || longitude === undefined || !found) return null
  const label = [found, text(match.admin1) !== found ? text(match.admin1) : undefined, text(match.country)]
    .filter(Boolean)
    .join(', ')
  return { name: found, label, latitude, longitude }
}

async function weather(place: string, signal: AbortSignal): Promise<Pick<ToolOutcome, 'content' | 'detail' | 'source'>> {
  const found = await geocode(place, signal)
  if (!found) {
    return {
      content: `No place called "${place}" was found by the geocoding service, so there is no weather to report.`,
      detail: `No place found for "${place}"`,
    }
  }
  const url = new URL(FORECAST_URL)
  url.search = new URLSearchParams({
    latitude: String(found.latitude),
    longitude: String(found.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '1',
  }).toString()
  const data = asRecord(await getJson(url.toString(), signal))
  const now = asRecord(data.current)
  const nowUnits = asRecord(data.current_units)
  const daily = asRecord(data.daily)
  const dailyUnits = asRecord(data.daily_units)
  const first = (value: unknown) => (Array.isArray(value) ? value[0] : undefined)

  const temperature = measure(now.temperature_2m, nowUnits.temperature_2m)
  if (!temperature) throw new Error('forecast had no current temperature')
  const code = num(now.weather_code)
  const sky = code === undefined ? undefined : WMO_CODES[code]
  const parts = [
    `Weather for ${found.label}${text(now.time) ? ` (local time ${text(now.time)})` : ''}.`,
    `Now: ${temperature}${sky ? `, ${sky}` : ''}.`,
    measure(now.apparent_temperature, nowUnits.apparent_temperature) &&
      `Feels like ${measure(now.apparent_temperature, nowUnits.apparent_temperature)}.`,
    measure(now.relative_humidity_2m, nowUnits.relative_humidity_2m, 0) &&
      `Humidity ${measure(now.relative_humidity_2m, nowUnits.relative_humidity_2m, 0)}.`,
    measure(now.wind_speed_10m, nowUnits.wind_speed_10m) &&
      `Wind ${measure(now.wind_speed_10m, nowUnits.wind_speed_10m)}.`,
    measure(first(daily.temperature_2m_max), dailyUnits.temperature_2m_max) &&
      `Today's high ${measure(first(daily.temperature_2m_max), dailyUnits.temperature_2m_max)}`,
    measure(first(daily.temperature_2m_min), dailyUnits.temperature_2m_min) &&
      `low ${measure(first(daily.temperature_2m_min), dailyUnits.temperature_2m_min)}.`,
    'Source: Open-Meteo.',
  ].filter(Boolean)
  return {
    content: cap(parts.join(' '), MAX_RESULT_CHARS),
    detail: `${found.label}: ${temperature}${sky ? `, ${sky}` : ''}`,
    source: url.toString(),
  }
}

function summaryUrl(title: string): string {
  return WIKI_SUMMARY_URL + encodeURIComponent(title.replace(/ /g, '_'))
}

async function wikipediaSummary(topic: string, signal: AbortSignal): Promise<Pick<ToolOutcome, 'content' | 'detail' | 'source'>> {
  const headers = { 'user-agent': USER_AGENT }
  let data: Record<string, unknown>
  try {
    data = asRecord(await getJson(summaryUrl(topic), signal, headers))
  } catch (err) {
    if (!(err instanceof NotFound)) throw err
    // No article under that exact title: take the top result of a full-text search.
    const search = new URL(WIKI_SEARCH_URL)
    search.search = new URLSearchParams({ q: topic, limit: '1' }).toString()
    const pages = asRecord(await getJson(search.toString(), signal, headers)).pages
    const key = Array.isArray(pages) ? text(asRecord(pages[0]).key) : undefined
    if (!key) {
      return {
        content: `Wikipedia has no article matching "${topic}", so there is nothing to summarise.`,
        detail: `No article found for "${topic}"`,
      }
    }
    data = asRecord(await getJson(summaryUrl(key), signal, headers))
  }

  const title = text(data.title)
  const extract = text(data.extract)
  const page = text(asRecord(asRecord(data.content_urls).desktop).page)
  if (!title || !extract || !page) {
    return {
      content: `Wikipedia returned no readable summary for "${topic}".`,
      detail: `No summary for "${topic}"`,
    }
  }
  const ambiguous = data.type === 'disambiguation'
  const body = cap(extract, MAX_EXTRACT_CHARS)
  return {
    content:
      `${title}${text(data.description) ? ` (${text(data.description)})` : ''}: ${body}` +
      `${ambiguous ? ' This is a disambiguation page, so the topic is ambiguous; ask which meaning the user wants.' : ''}` +
      ` Source: ${page}`,
    detail: ambiguous ? `${title} (disambiguation page)` : title,
    source: page,
  }
}

const SERVICE_DOWN: Record<ToolName, string> = {
  weather: 'The weather service did not answer',
  wikipedia_summary: 'Wikipedia did not answer',
}
const NO_DATA = 'No data is available, so tell the user that instead of guessing.'

// Runs one tool call from the model. It never throws: a bad call, a timeout or a
// failed upstream becomes a sentence the model can say aloud.
export async function runTool(name: string, rawArguments: string, deadlineAt: number): Promise<ToolOutcome> {
  const started = Date.now()
  const done = (outcome: Omit<ToolOutcome, 'ms'>): ToolOutcome => ({ ...outcome, ms: Date.now() - started })

  if (name !== 'weather' && name !== 'wikipedia_summary') {
    return done({ ok: false, call: cap(name, MAX_ARGUMENT_CHARS), content: `That tool does not exist. ${NO_DATA}`, detail: 'The model asked for a tool that is not offered' })
  }
  const key = name === 'weather' ? 'place' : 'topic'
  let argument: string
  try {
    argument = readArgument(rawArguments, key)
  } catch (err) {
    const reason = err instanceof ToolFailure ? err.message : 'The tool arguments could not be read.'
    return done({ ok: false, call: `${name}()`, content: `${reason} Nothing was looked up.`, detail: reason })
  }
  const call = `${name}(${JSON.stringify(argument)})`

  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) {
    return done({ ok: false, call, content: `${SERVICE_DOWN[name]} in time: the run's time limit was reached. ${NO_DATA}`, detail: 'No time left in the run budget' })
  }
  try {
    const signal = AbortSignal.timeout(Math.min(TOOL_TIMEOUT_MS, remaining))
    const result = name === 'weather' ? await weather(argument, signal) : await wikipediaSummary(argument, signal)
    return done({ ok: true, call, ...result })
  } catch (err) {
    console.error(`tools: ${name} failed`, err)
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return done({
      ok: false,
      call,
      content: `${SERVICE_DOWN[name]}${timedOut ? ' in time' : ''}. ${NO_DATA}`,
      detail: timedOut ? 'No reply before the 3 second limit' : 'The service could not be reached or answered with an error',
    })
  }
}
