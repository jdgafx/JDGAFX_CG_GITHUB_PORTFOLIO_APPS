import { parseCSV } from '../dataEngine'
import type { ParsedData } from '../../types'

/** The provider answered, but not with the table this page expects. */
export class DatasetFormatError extends Error {
  readonly reason: 'malformed' | 'empty'

  constructor(reason: 'malformed' | 'empty') {
    super(reason === 'empty' ? 'The response had no data rows.' : 'The response was not the expected CSV.')
    this.name = 'DatasetFormatError'
    this.reason = reason
  }
}

/** USGS writes some places with a two-letter code instead of a name. */
const PLACE_CODES = new Map([
  ['CA', 'California'],
  ['MX', 'Mexico'],
])

/**
 * A readable region from a USGS place string: the text after the last comma
 * ("5 km SW of Cobb, CA" -> "California"), or the whole text when there is no comma
 * ("Fiji region"). A blank place stays blank.
 */
export function regionFromPlace(place: string): string {
  const text = place.trim()
  const tail = text.slice(text.lastIndexOf(',') + 1).trim() || text
  return PLACE_CODES.get(tail) ?? tail
}

function readTable(text: string, requiredHeaders: string[]): ParsedData {
  let table: ParsedData
  try {
    table = parseCSV(text)
  } catch {
    throw new DatasetFormatError('malformed')
  }
  if (!requiredHeaders.every((header) => table.headers.includes(header))) throw new DatasetFormatError('malformed')
  if (table.rows.length === 0) throw new DatasetFormatError('empty')
  return table
}

/** The USGS earthquake CSV, with a `region` column added right after `place`. */
export function parseEarthquakeCsv(text: string): ParsedData {
  const table = readTable(text, ['time', 'mag', 'magType', 'place', 'type'])
  const headers = table.headers.flatMap((header) => (header === 'place' ? [header, 'region'] : [header]))
  const rows = table.rows.map((row) => ({ ...row, region: regionFromPlace(row.place ?? '') }))
  return { ...table, headers, rows }
}

/** Open-Meteo's own column names, mapped to plain ones a question can name. */
const WEATHER_COLUMNS: [source: string, name: string][] = [
  ['time', 'date'],
  ['temperature_2m_max (°C)', 'temp_max_c'],
  ['temperature_2m_min (°C)', 'temp_min_c'],
  ['precipitation_sum (mm)', 'precipitation_mm'],
]

/**
 * The Open-Meteo daily CSV. It opens with a metadata block (coordinates, elevation, timezone)
 * and a blank line before the real header, so everything above the `time,` header is dropped.
 * Columns get plain names and a `month` (YYYY-MM) column is derived from the date.
 */
export function parseWeatherCsv(text: string): ParsedData {
  const lines = text.split(/\r?\n/)
  const headerAt = lines.findIndex((line) => line.startsWith('time,'))
  if (headerAt === -1) throw new DatasetFormatError('malformed')

  const table = readTable(lines.slice(headerAt).join('\n'), WEATHER_COLUMNS.map(([source]) => source))
  const rows = table.rows.map((row) => {
    const out: Record<string, string> = {}
    for (const [source, name] of WEATHER_COLUMNS) {
      out[name] = row[source] ?? ''
      if (name === 'date') out.month = (row[source] ?? '').slice(0, 7)
    }
    return out
  })
  return { ...table, headers: ['date', 'month', ...WEATHER_COLUMNS.slice(1).map(([, name]) => name)], rows }
}
