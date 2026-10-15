import { PlainError } from './errors'
import { withLimit } from './limit'
import { isAbortError, isRecord, isTimeoutError } from './json'
import { EXTRACT_CHARS, type PageText, type SearchHit } from './wikipedia'

/**
 * The current web, through Tavily's free tier (1,000 credits a month). Wikipedia gets the
 * encyclopedia; this gets everything published since. Both answer in the same shapes, so a web
 * page becomes a numbered source through the same numbering, citation and critic path as a
 * Wikipedia page, and the answer rules never change.
 */
const SEARCH_API = 'https://api.tavily.com/search'
const EXTRACT_API = 'https://api.tavily.com/extract'

/** Each web call gets this long, and the run budget can end it sooner. */
export const WEB_TIMEOUT_MS = 8_000
/** The most characters of one web page the agent reads. */
export const WEB_EXTRACT_CHARS = EXTRACT_CHARS
/** How many results one web search returns. */
export const WEB_RESULTS = 5
/** Tavily identifies the caller by the key alone; the User-Agent names the app and its live address. */
export const USER_AGENT = 'GraphScout/1.0 (+https://jdgafx-app-11-langgraph-research-agent.netlify.app)'

/** The web layer. Tests inject a fake one; the function uses `liveWeb`. */
export interface WebTools {
  search(query: string, signal: AbortSignal): Promise<SearchHit[]>
  page(url: string, signal: AbortSignal): Promise<PageText>
}

/** A failed web lookup. The message is plain and is shown to the model as the tool result. */
export class WebError extends PlainError {
  constructor(status: number, message: string) {
    super(status, message)
    this.name = 'WebError'
  }
}

/** The name shown for a web source when the search returned no title: the site's host, without `www.`. */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 60)
  }
}

/** Reads a search reply: up to WEB_RESULTS results with their titles and extracted text. */
export function parseWebSearch(json: unknown): SearchHit[] {
  if (!isRecord(json)) throw new WebError(502, 'The web search sent a reply that could not be read.')
  if (typeof json.detail === 'string') throw new WebError(502, 'The web search returned an error.')
  const results: unknown[] = Array.isArray(json.results) ? json.results : []
  return results
    .flatMap((item): SearchHit[] => {
      if (!isRecord(item) || typeof item.url !== 'string') return []
      const title = typeof item.title === 'string' && item.title.trim() !== '' ? item.title.trim() : siteName(item.url)
      const snippet = typeof item.content === 'string' ? item.content.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
      return [{ title, url: item.url, snippet }]
    })
    .slice(0, WEB_RESULTS)
}

/** Reads an extract reply: the page's own text, cut to WEB_EXTRACT_CHARS. */
export function parseWebPage(json: unknown, url: string, title: string): PageText {
  if (!isRecord(json)) throw new WebError(502, 'The web page lookup sent a reply that could not be read.')
  const results: unknown[] = Array.isArray(json.results) ? json.results : []
  const page = results.find((item): item is Record<string, unknown> => isRecord(item) && typeof item.raw_content === 'string')
  const extract = page && typeof page.raw_content === 'string' ? page.raw_content.replace(/\s+/g, ' ').trim() : ''
  if (extract === '') throw new WebError(404, `The web page at ${url} could not be read.`)
  return { title, url, extract: extract.slice(0, WEB_EXTRACT_CHARS).trim() }
}

/** Reads a key from the body, taking back the one string Tavily is answering with. */
async function post(url: string, body: unknown, key: string, signal: AbortSignal, action: string): Promise<unknown> {
  try {
    return await withLimit(signal, WEB_TIMEOUT_MS, async (callSignal) => {
      let response: Response
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT, Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          signal: callSignal,
        })
      } catch (err) {
        throw isAbortError(err) ? err : new WebError(502, 'Could not reach the web search.')
      }
      if (response.status === 401 || response.status === 403) throw new WebError(502, 'The web search refused its key.')
      if (response.status === 429) throw new WebError(502, 'The web search is over its free monthly limit.')
      if (!response.ok) throw new WebError(502, 'The web search returned an error.')
      try {
        return (await response.json()) as unknown
      } catch (err) {
        throw isAbortError(err) ? err : new WebError(502, 'The web search sent a reply that could not be read.')
      }
    })
  } catch (err) {
    if (err instanceof WebError) throw err
    if (isAbortError(err)) {
      throw new WebError(
        504,
        signal.aborted && !isTimeoutError(err) ? `The run's time limit ended the ${action}.` : `The ${action} timed out.`,
      )
    }
    throw new WebError(502, 'Could not reach the web search.')
  }
}

export async function searchWeb(query: string, key: string, signal: AbortSignal): Promise<SearchHit[]> {
  const body = { query, max_results: WEB_RESULTS, search_depth: 'basic' }
  return parseWebSearch(await post(SEARCH_API, body, key, signal, 'web search'))
}

export async function readWebPage(url: string, title: string, key: string, signal: AbortSignal): Promise<PageText> {
  const page = parseWebPage(await post(EXTRACT_API, { urls: [url] }, key, signal, 'web page lookup'), url, title)
  return page
}

/**
 * The live web tools, or null when no key is set. Null keeps the app working on Wikipedia alone:
 * the web tools are then not offered to the model at all, so it never asks for one and the run
 * behaves exactly as it did before.
 */
export function webTools(key: string | undefined): WebTools | null {
  if (!key) return null
  return {
    search: (query, signal) => searchWeb(query, key, signal),
    page: (url, signal) => readWebPage(url, siteName(url), key, signal),
  }
}

/** The key the function reads. Only the key's presence is ever logged. */
export const WEB_KEY_ENV = 'TAVILY_API_KEY'
