import { buildArticle, extractUrl, readPage, readSearch, searchUrl, WikiError, type Article } from './wikipedia'

/** Each request gives up after this long. An article is a larger reply than a list of titles. */
export const ARTICLE_TIMEOUT_MS = 15_000
export const SEARCH_TIMEOUT_MS = 8_000

/**
 * One GET with a timeout. A caller's abort is passed on as the abort it is, so the screen can ignore it.
 * Everything else becomes a WikiError with a message to show as it is.
 */
async function getJson(url: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs)
  try {
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    if (!response.ok) {
      throw new WikiError('unavailable', `Wikipedia answered with status ${response.status}. Try again in a moment.`)
    }
    return await response.json()
  } catch (err) {
    if (err instanceof WikiError) throw err
    if (signal?.aborted) throw err
    if (timeout.aborted) throw new WikiError('timeout', 'Wikipedia took too long to answer. Try again.')
    if (err instanceof SyntaxError) throw new WikiError('bad_response', 'Wikipedia sent a reply this app could not read. Try again.')
    throw new WikiError('network', 'Could not reach Wikipedia. Check your connection and try again.')
  }
}

/** Article titles that match a search, best first. */
export async function searchTitles(query: string, signal?: AbortSignal): Promise<string[]> {
  return readSearch(await getJson(searchUrl(query), SEARCH_TIMEOUT_MS, signal))
}

/** Loads one article as analysis-ready text. Throws a WikiError for every failure the visitor should see. */
export async function loadArticle(title: string, signal?: AbortSignal): Promise<Article> {
  const page = readPage(await getJson(extractUrl(title), ARTICLE_TIMEOUT_MS, signal))
  switch (page.kind) {
    case 'ok':
      return buildArticle(page)
    case 'missing':
      throw new WikiError('not_found', `No Wikipedia article is titled "${title.trim()}".`)
    case 'disambiguation':
      throw new WikiError('disambiguation', `"${page.title}" is a disambiguation page: it lists several articles and has no text of its own.`)
    case 'invalid':
      throw new WikiError('bad_response', 'Wikipedia sent a reply this app could not read. Try again.')
  }
}
