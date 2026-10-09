import { PlainError } from './errors'
import { withLimit } from './limit'
import { isAbortError, isRecord, isTimeoutError } from './json'

const API = 'https://en.wikipedia.org/w/api.php'
const SITE = 'https://en.wikipedia.org'

/** Each Wikipedia call gets this long, and the run budget can end it sooner. */
export const TOOL_TIMEOUT_MS = 6_000
/** The most characters of one page the agent reads. */
export const EXTRACT_CHARS = 2_500
/** Wikipedia asks for an identifying User-Agent. It names the app and its live address only. */
export const USER_AGENT = 'GraphScout/1.0 (+https://jdgafx-app-11-langgraph-research-agent.netlify.app)'

export interface SearchHit {
  title: string
  snippet: string
}

export interface PageText {
  title: string
  url: string
  extract: string
}

/** The Wikipedia layer. Tests inject a fake one; the function uses `liveWiki`. */
export interface WikiTools {
  search(query: string, signal: AbortSignal): Promise<SearchHit[]>
  page(title: string, signal: AbortSignal): Promise<PageText>
}

/** A failed lookup. The message is plain and is shown to the model as the tool result. */
export class WikiError extends PlainError {
  constructor(status: number, message: string) {
    super(status, message)
    this.name = 'WikiError'
  }
}

export function searchUrl(query: string): string {
  return `${API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5&utf8=1`
}

export function pageUrl(title: string): string {
  return `${API}?action=query&prop=extracts&explaintext=1&exintro=0&titles=${encodeURIComponent(title)}&format=json&redirects=1`
}

export function canonicalUrl(title: string): string {
  return `${SITE}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntity(body: string, original: string): string {
  if (body.startsWith('#')) {
    const hex = body[1] === 'x' || body[1] === 'X'
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : original
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? original
}

/** Strips HTML tags from a search snippet, decodes entities and collapses whitespace. */
export function cleanText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match: string, body: string) => decodeEntity(body, match))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Reads a search reply: up to five titles with their cleaned snippets. */
export function parseSearch(json: unknown): SearchHit[] {
  if (!isRecord(json)) throw new WikiError(502, 'Wikipedia sent a reply that could not be read.')
  if ('error' in json) throw new WikiError(502, 'Wikipedia returned an error.')
  const results: unknown[] = isRecord(json.query) && Array.isArray(json.query.search) ? json.query.search : []
  return results.flatMap((item): SearchHit[] => {
    if (!isRecord(item) || typeof item.title !== 'string') return []
    const snippet = typeof item.snippet === 'string' ? cleanText(item.snippet) : ''
    return [{ title: item.title, snippet }]
  })
}

/** Reads a page reply: the canonical title and URL, and the first EXTRACT_CHARS of plain text. */
export function parsePage(json: unknown, requestedTitle: string): PageText {
  if (!isRecord(json) || 'error' in json) throw new WikiError(502, 'Wikipedia returned an error.')
  const query = isRecord(json.query) ? json.query : {}
  const pages: unknown[] = isRecord(query.pages) ? Object.values(query.pages) : []
  const page = pages.find(isRecord)
  if (!page || 'missing' in page || typeof page.title !== 'string') {
    throw new WikiError(404, `No Wikipedia page has the title "${requestedTitle}".`)
  }
  const extract = typeof page.extract === 'string' ? page.extract.trim().slice(0, EXTRACT_CHARS).trim() : ''
  if (extract === '') throw new WikiError(404, `The Wikipedia page "${page.title}" has no readable text.`)
  return { title: page.title, url: canonicalUrl(page.title), extract }
}

async function getJson(url: string, signal: AbortSignal, action: string): Promise<unknown> {
  const timedOut = (err: unknown) =>
    new WikiError(
      504,
      signal.aborted && !isTimeoutError(err) ? `The run's time limit ended the ${action}.` : `The ${action} timed out.`,
    )
  // The whole call, body read included, ends when the run budget aborts or after the per-call limit.
  try {
    return await withLimit(signal, TOOL_TIMEOUT_MS, async (callSignal) => {
      let response: Response
      try {
        response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: callSignal })
      } catch (err) {
        throw isAbortError(err) ? err : new WikiError(502, 'Could not reach Wikipedia.')
      }
      if (!response.ok) throw new WikiError(502, 'Wikipedia returned an error.')
      try {
        return (await response.json()) as unknown
      } catch (err) {
        throw isAbortError(err) ? err : new WikiError(502, 'Wikipedia sent a reply that could not be read.')
      }
    })
  } catch (err) {
    if (err instanceof WikiError) throw err
    throw isAbortError(err) ? timedOut(err) : new WikiError(502, 'Could not reach Wikipedia.')
  }
}

export async function searchWikipedia(query: string, signal: AbortSignal): Promise<SearchHit[]> {
  return parseSearch(await getJson(searchUrl(query), signal, 'Wikipedia search'))
}

export async function readWikipediaPage(title: string, signal: AbortSignal): Promise<PageText> {
  return parsePage(await getJson(pageUrl(title), signal, 'Wikipedia page lookup'), title)
}

export const liveWiki: WikiTools = {
  search: searchWikipedia,
  page: readWikipediaPage,
}
