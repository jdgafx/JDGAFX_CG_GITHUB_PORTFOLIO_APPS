// The Wikipedia lead of the example topic, read straight from Wikipedia's public REST API when the page loads.
// No model is involved: this is the free live source the Sources step also reads (en.wikipedia.org).

export interface WikiLead {
  title: string
  /** One-line description Wikipedia keeps for the article, when it has one. */
  description: string
  /** The article's opening paragraph(s), plain text. */
  extract: string
  /** The article on en.wikipedia.org. */
  url: string
}

const SEARCH_URL = 'https://en.wikipedia.org/w/rest.php/v1/search/page'
const SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary/'
const ARTICLE_PREFIX = 'https://en.wikipedia.org/wiki/'
export const WIKI_TIMEOUT_MS = 8_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The page key of the best match for the topic, or null when Wikipedia found nothing. */
export function searchKey(reply: unknown): string | null {
  if (!isRecord(reply) || !Array.isArray(reply.pages)) return null
  const first: unknown = reply.pages[0]
  return isRecord(first) && typeof first.key === 'string' && first.key !== '' ? first.key : null
}

/** The lead of a summary reply, or null for a reply that is not a plain article (a disambiguation page, a missing page, anything unreadable). */
export function leadFrom(reply: unknown): WikiLead | null {
  if (!isRecord(reply) || reply.type !== 'standard') return null
  const { title, extract, description } = reply
  if (typeof title !== 'string' || title === '' || typeof extract !== 'string' || extract.trim() === '') return null
  const urls = isRecord(reply.content_urls) && isRecord(reply.content_urls.desktop) ? reply.content_urls.desktop.page : undefined
  const url = typeof urls === 'string' && urls.startsWith(ARTICLE_PREFIX) ? urls : `${ARTICLE_PREFIX}${encodeURIComponent(title.replace(/ /g, '_'))}`
  return { title, description: typeof description === 'string' ? description : '', extract: extract.trim(), url }
}

async function getJson(url: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`)
  return res.json()
}

/** Looks the topic up and returns its Wikipedia lead. Throws when Wikipedia cannot be reached or has no plain article for it. */
export async function fetchLead(topic: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<WikiLead> {
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(WIKI_TIMEOUT_MS)])
  const key = searchKey(await getJson(`${SEARCH_URL}?${new URLSearchParams({ q: topic, limit: '1' })}`, timeout, fetchImpl))
  if (!key) throw new Error('Wikipedia has no article for this topic.')
  const lead = leadFrom(await getJson(`${SUMMARY_URL}${encodeURIComponent(key)}`, timeout, fetchImpl))
  if (!lead) throw new Error('Wikipedia has no plain article for this topic.')
  return lead
}
