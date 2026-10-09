import { MAX_FILE_SIZE } from './constants'
import { pageMarkerPattern } from './chunk'

const API = 'https://en.wikipedia.org/w/api.php'

/** Longest wait for one Wikipedia request. */
const REQUEST_TIMEOUT_MS = 15_000

/** Suggestions shown under the search box. */
const SUGGESTION_LIMIT = 6

/** Headings that hold lists of links and citations, not prose worth asking about. */
const BACK_MATTER = new Set([
  'see also',
  'notes',
  'references',
  'further reading',
  'external links',
  'bibliography',
  'sources',
  'citations',
  'footnotes',
  'works cited',
])

/** A request to Wikipedia that failed, with a sentence safe to show. */
export class WikipediaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WikipediaError'
  }
}

function apiUrl(params: Record<string, string>): string {
  // origin=* makes the API answer cross-origin browser requests.
  return `${API}?${new URLSearchParams({ ...params, format: 'json', origin: '*' }).toString()}`
}

/** Title search for the suggestion list. */
export function buildSearchUrl(query: string): string {
  return apiUrl({ action: 'opensearch', search: query.trim(), namespace: '0', limit: String(SUGGESTION_LIMIT) })
}

/** The plain-text extract of one article, with "== Heading ==" lines and its canonical URL. */
export function buildExtractUrl(title: string): string {
  return apiUrl({
    action: 'query',
    prop: 'extracts|info',
    explaintext: '1',
    exsectionformat: 'wiki',
    redirects: '1',
    inprop: 'url',
    titles: title.trim(),
    formatversion: '2',
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** Titles from an opensearch reply, which is [query, [titles], [descriptions], [urls]]. */
export function parseSuggestions(raw: unknown): string[] {
  const titles: unknown = Array.isArray(raw) ? (raw as unknown[])[1] : undefined
  return Array.isArray(titles) ? (titles as unknown[]).filter((t): t is string => typeof t === 'string' && t !== '') : []
}

export interface WikipediaExtract {
  title: string
  url: string
  extract: string
}

/** The one article in a query reply. Throws a WikipediaError for a missing page or an empty extract. */
export function parseExtract(raw: unknown, requested: string): WikipediaExtract {
  const pages: unknown = asRecord(asRecord(raw)['query'])['pages']
  const page = asRecord(Array.isArray(pages) ? (pages as unknown[])[0] : undefined)
  if (page['missing'] === true || page['invalid'] === true || typeof page['title'] !== 'string') {
    throw new WikipediaError(`Wikipedia has no article titled "${requested.trim()}".`)
  }
  const extract = typeof page['extract'] === 'string' ? page['extract'] : ''
  if (extract.trim() === '') {
    throw new WikipediaError(`The article "${page['title']}" has no text to read. Try a different article.`)
  }
  const url = typeof page['canonicalurl'] === 'string' ? page['canonicalurl'] : typeof page['fullurl'] === 'string' ? page['fullurl'] : ''
  return { title: page['title'], url, extract }
}

export interface SectionedText {
  /** Text with a "--- Page N ---" marker before each section, N counting from 1. */
  text: string
  /** Section titles in order. Entry n is section n + 1. Nested ones read "Parent > Child". */
  sectionTitles: string[]
  /** True when later sections were left out to stay under the size cap. */
  truncated: boolean
}

const HEADING = /^(={2,6})[ \t]*(.+?)[ \t]*\1[ \t]*$/

/**
 * Turns an article extract into numbered sections. The text before the first heading is
 * section 1, titled with the article. Each heading starts the next section. Sections with
 * no text, the reference lists at the end and everything under them are dropped. The
 * markers are the ones the PDF reader writes, so citations work the same way, but the
 * numbers count sections, not pages. Sections that would push the text past `maxChars`
 * are left out.
 */
export function sectionsToPages(extract: string, articleTitle: string, maxChars: number = MAX_FILE_SIZE): SectionedText {
  interface Raw {
    path: string[]
    level: number
    body: string[]
  }
  const raws: Raw[] = [{ path: [articleTitle], level: 1, body: [] }]
  const trail: Array<{ level: number; title: string }> = []
  // While set, headings deeper than this level belong to a dropped back-matter section.
  let droppedLevel: number | null = null

  for (const line of extract.split('\n')) {
    const heading = HEADING.exec(line)
    if (!heading) {
      if (droppedLevel === null) raws[raws.length - 1]?.body.push(line)
      continue
    }
    const level = (heading[1] ?? '').length
    const title = (heading[2] ?? '').trim()
    if (droppedLevel !== null && level > droppedLevel) continue
    droppedLevel = BACK_MATTER.has(title.toLowerCase()) ? level : null

    while (trail.length > 0 && (trail[trail.length - 1]?.level ?? 0) >= level) trail.pop()
    trail.push({ level, title })
    if (droppedLevel === null) raws.push({ path: trail.map(t => t.title), level, body: [] })
  }

  const parts: string[] = []
  const sectionTitles: string[] = []
  let size = 0
  let truncated = false
  for (const raw of raws) {
    const body = raw.body.join('\n').replace(pageMarkerPattern(), '').trim()
    if (body === '') continue
    const title = raw.path.join(' > ')
    const part = `--- Page ${sectionTitles.length + 1} ---\n${raw.path[raw.path.length - 1]}\n${body}`
    if (size + part.length > maxChars) {
      truncated = true
      break
    }
    parts.push(part)
    sectionTitles.push(title)
    size += part.length
  }
  return { text: parts.join('\n\n'), sectionTitles, truncated }
}

async function getJson(url: string, signal: AbortSignal | undefined): Promise<unknown> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, { signal: signal ? AbortSignal.any([timeout, signal]) : timeout })
  } catch (err) {
    if (signal?.aborted) throw err
    if (timeout.aborted) throw new WikipediaError('Wikipedia did not answer in time. Try again.')
    throw new WikipediaError('Could not reach Wikipedia. Check your connection and try again.')
  }
  if (!response.ok) throw new WikipediaError(`Wikipedia answered with an error (${response.status}). Try again shortly.`)
  try {
    return (await response.json()) as unknown
  } catch {
    throw new WikipediaError('Wikipedia returned a reply that could not be read. Try again.')
  }
}

/** Article titles that start like the query. An empty query has none. */
export async function searchTitles(query: string, signal?: AbortSignal): Promise<string[]> {
  if (query.trim() === '') return []
  return parseSuggestions(await getJson(buildSearchUrl(query), signal))
}

export interface WikipediaArticle extends SectionedText {
  title: string
  url: string
}

/** Fetches one article live and splits it into sections. */
export async function fetchArticle(title: string, signal?: AbortSignal): Promise<WikipediaArticle> {
  const { title: canonical, url, extract } = parseExtract(await getJson(buildExtractUrl(title), signal), title)
  const sections = sectionsToPages(extract, canonical)
  if (sections.sectionTitles.length === 0) {
    throw new WikipediaError(`The article "${canonical}" has no text to read. Try a different article.`)
  }
  return { title: canonical, url, ...sections }
}
