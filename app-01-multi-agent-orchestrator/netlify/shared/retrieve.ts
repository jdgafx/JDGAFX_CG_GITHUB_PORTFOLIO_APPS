import type { Source } from '../../src/types'
import { withDeadline } from './deadline'

/** Wikimedia and arXiv ask API clients to identify themselves. */
const USER_AGENT = 'AgentFlow/1.0 (https://jdgafx-app-01-multi-agent-orchestrator.netlify.app; portfolio project)'

/** Every lookup runs in parallel under its own copy of this ceiling. The run budget can shorten it. */
export const RETRIEVE_TIMEOUT_MS = 4_000
/** A reply larger than this is refused unread. Real replies are a few KB to a few tens of KB. */
const MAX_RESPONSE_BYTES = 200_000
/** Characters of one source passed to the model and shown on the page. The audit endpoint takes the same. */
export const MAX_SNIPPET_CHARS = 500
/** Characters of the whole source block in the Researcher's message: room for eight sources of about 550 characters. */
export const MAX_PROMPT_SOURCES_CHARS = 4_400
/** At most 8 sources reach the Researcher and the audit endpoint: web 3, arXiv 2, Hacker News 2, Wikipedia 1. */
const WEB_LIMIT = 3
const ARXIV_LIMIT = 2
const HN_LIMIT = 2
const WIKIPEDIA_LIMIT = 1
/** Candidates asked for, so the relevance rule has some to drop. */
const WEB_CANDIDATES = 6
const ARXIV_CANDIDATES = 10
const WIKIPEDIA_CANDIDATES = 5
const HN_MIN_POINTS = 20
const MAX_TERMS = 8
const MAX_TITLE_CHARS = 200

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php'
const HN_API = 'https://hn.algolia.com/api/v1/search'
const ARXIV_API = 'https://export.arxiv.org/api/query'
const TAVILY_SEARCH_API = 'https://api.tavily.com/search'

export type RawSource = Omit<Source, 'n'>

/** Words that carry no topic: question openers, auxiliaries, articles and filler. */
const STOPWORDS = new Set(
  `a an and are as at be been being but by can could did do does for from had has have how i if in into is it its
  me my of on or our should so than that the their them then there these they this those to us was we were what
  when where which who whom whose why will with would you your about between versus vs current today now`.split(/\s+/),
)

/** The topic words of a question, in order, without question openers and filler. Capped at eight. */
export function searchTerms(query: string): string {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of query.split(/\s+/)) {
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#]+$/gu, '').slice(0, 40)
    const key = word.toLowerCase()
    if (!word || STOPWORDS.has(key) || seen.has(key)) continue
    seen.add(key)
    terms.push(word)
    if (terms.length === MAX_TERMS) break
  }
  return terms.length > 0 ? terms.join(' ') : query.trim().slice(0, 120)
}

/** `any` asks for pages that carry any of the words (OR) instead of all of them, which long questions need. */
export function wikipediaSearchUrl(terms: string, any = false): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: any ? terms.split(' ').filter(Boolean).join(' OR ') : terms,
    gsrnamespace: '0',
    gsrlimit: String(WIKIPEDIA_CANDIDATES),
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    exchars: String(MAX_SNIPPET_CHARS),
    exlimit: String(WIKIPEDIA_CANDIDATES),
  })
  return `${WIKIPEDIA_API}?${params}`
}

export function hnSearchUrl(terms: string): string {
  const params = new URLSearchParams({
    query: terms,
    tags: 'story',
    numericFilters: `points>${HN_MIN_POINTS}`,
    hitsPerPage: '6',
    // Without this a single extra word in the question (such as "discovered") returns nothing.
    removeWordsIfNoResults: 'allOptional',
  })
  return `${HN_API}?${params}`
}

/** arXiv answers XML. Any of the words, best match first; the relevance rule then keeps the real matches. */
export function arxivSearchUrl(terms: string): string {
  const query = terms
    .split(' ')
    .map(word => word.replace(/"/g, ''))
    .filter(Boolean)
    .map(word => `all:"${word}"`)
    .join(' OR ')
  const params = new URLSearchParams({ search_query: query, start: '0', max_results: String(ARXIV_CANDIDATES), sortBy: 'relevance' })
  return `${ARXIV_API}?${params}`
}

/** What Tavily is sent: the raw question and one search call. No page extraction. */
export function tavilySearchBody(query: string): string {
  return JSON.stringify({ query, max_results: WEB_CANDIDATES, search_depth: 'basic', include_answer: false })
}

/** Collapses whitespace, drops control characters and cuts at a word boundary with an ellipsis. */
export function capText(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const head = clean.slice(0, max)
  const space = head.lastIndexOf(' ')
  return `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}…`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Brackets and parentheses are escaped, so a link still parses inside a markdown list line. */
function escapeLinkChars(url: string): string {
  return url.replace(/[()[\]]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function wikipediaArticleUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${escapeLinkChars(encodeURIComponent(title.replace(/ /g, '_')))}`
}

function httpsHost(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.hostname.replace(/^www\./, '') : undefined
  } catch {
    return undefined
  }
}

/** A page link from a search reply: https only, no login in it, brackets escaped. Anything else is dropped. */
function webLink(value: unknown): string | undefined {
  if (!httpsHost(value)) return undefined
  const url = new URL(String(value))
  if (url.username || url.password || url.href.length > 1_000) return undefined
  return escapeLinkChars(url.href)
}

const stem = (word: string) => (word.length > 3 ? word.replace(/s$/, '') : word)
const wordsIn = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? []

/** Search words a source must carry in its title and text: 60% of them, at most three. Loose matches are dropped. */
function wordsNeeded(termCount: number): number {
  return Math.min(3, Math.ceil(termCount * 0.6))
}

/**
 * The one relevance rule, the same for every site: the title and text carry enough of the question's topic words.
 * A word matches ignoring case and a plural s; a hyphenated or dotted word (server-sent, Node.js) needs all its parts.
 * shortcut: no stemming beyond the plural s, so "streaming" does not match "stream"; upgrade if real questions lose sources to it.
 */
export function isRelevant(terms: string, title: string, text: string): boolean {
  const topic = terms.split(' ').filter(Boolean)
  const have = new Set(wordsIn(`${title} ${text}`).map(stem))
  const hits = topic.filter(term => {
    const parts = wordsIn(term).map(stem)
    return parts.length > 0 && parts.every(part => have.has(part))
  })
  return hits.length >= wordsNeeded(topic.length)
}

/** Articles in search rank order. A page without a title or intro text, or off topic, is dropped. */
export function parseWikipedia(body: unknown, terms: string): RawSource[] {
  const pages = isRecord(body) && isRecord(body.query) && Array.isArray(body.query.pages) ? body.query.pages : []
  const ranked: Array<{ index: number; source: RawSource }> = []
  for (const page of pages) {
    if (!isRecord(page)) continue
    const title = typeof page.title === 'string' ? capText(page.title, MAX_TITLE_CHARS) : ''
    const extract = typeof page.extract === 'string' ? capText(page.extract, MAX_SNIPPET_CHARS) : ''
    if (!title || !extract || !isRelevant(terms, title, extract)) continue
    const index = typeof page.index === 'number' ? page.index : Number.MAX_SAFE_INTEGER
    ranked.push({ index, source: { title, site: 'Wikipedia', url: wikipediaArticleUrl(title), snippet: extract } })
  }
  return ranked.sort((a, b) => a.index - b.index).map(entry => entry.source)
}

function monthYear(iso: string): string | undefined {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return undefined
  return new Date(time).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/**
 * Hacker News stories that match the question. The link is always the discussion page, built
 * from a numeric id. A hit that fails the relevance rule is dropped.
 */
export function parseHn(body: unknown, terms: string): RawSource[] {
  const hits = isRecord(body) && Array.isArray(body.hits) ? body.hits : []
  const out: RawSource[] = []
  for (const hit of hits) {
    if (!isRecord(hit)) continue
    const title = typeof hit.title === 'string' ? capText(hit.title, MAX_TITLE_CHARS) : ''
    const id = typeof hit.objectID === 'string' && /^\d{1,12}$/.test(hit.objectID) ? hit.objectID : ''
    const points = typeof hit.points === 'number' && Number.isFinite(hit.points) ? hit.points : undefined
    if (!title || !id || points === undefined || points < HN_MIN_POINTS) continue

    const comments = typeof hit.num_comments === 'number' && Number.isFinite(hit.num_comments) ? hit.num_comments : 0
    const when = typeof hit.created_at === 'string' ? monthYear(hit.created_at) : undefined
    const host = httpsHost(hit.url)
    const note = [`${points.toLocaleString('en-US')} points`, `${comments.toLocaleString('en-US')} comments`, when]
      .filter(Boolean)
      .join(', ')
    const snippet = capText(`Hacker News story "${title}"${host ? `, linking to ${host}` : ''}. ${note}.`, MAX_SNIPPET_CHARS)
    if (!isRelevant(terms, title, snippet)) continue
    out.push({ title, site: 'Hacker News', url: `https://news.ycombinator.com/item?id=${id}`, snippet, note })
    if (out.length === HN_LIMIT) break
  }
  return out
}

/**
 * Pages from a Tavily search reply. The link is the one Tavily returned, kept only when it is a clean https link.
 * Its text is the snippet Tavily extracted. A result that fails the relevance rule is dropped.
 */
export function parseWebSearch(body: unknown, terms: string): RawSource[] {
  const results = isRecord(body) && Array.isArray(body.results) ? body.results : []
  const out: RawSource[] = []
  for (const item of results) {
    if (!isRecord(item)) continue
    const url = webLink(item.url)
    const host = httpsHost(item.url)
    const extract = typeof item.content === 'string' ? capText(item.content, MAX_SNIPPET_CHARS) : ''
    const title = typeof item.title === 'string' && item.title.trim() ? capText(item.title, MAX_TITLE_CHARS) : (host ?? '')
    if (!url || !host || !title || !extract || !isRelevant(terms, title, extract)) continue
    out.push({ title, site: 'Web', url, snippet: extract, note: host })
    if (out.length === WEB_LIMIT) break
  }
  return out
}

function xmlText(entry: string, tag: string): string {
  const found = entry.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  return (found?.[1] ?? '')
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Papers from an arXiv Atom reply. The link is built from the paper id (https://arxiv.org/abs/<id>), never copied.
 * An error entry has no such id and is dropped. A paper that fails the relevance rule is dropped.
 */
export function parseArxiv(xml: unknown, terms: string): RawSource[] {
  if (typeof xml !== 'string') return []
  const out: RawSource[] = []
  for (const entry of xml.split('<entry>').slice(1)) {
    const id = xmlText(entry, 'id').trim().match(/^https?:\/\/arxiv\.org\/abs\/([A-Za-z0-9.\-/]{1,40})$/)?.[1]
    const title = capText(xmlText(entry, 'title'), MAX_TITLE_CHARS)
    const abstract = capText(xmlText(entry, 'summary'), MAX_SNIPPET_CHARS)
    if (!id || !title || !abstract || !isRelevant(terms, title, abstract)) continue
    const when = monthYear(xmlText(entry, 'published').trim())
    out.push({ title, site: 'arXiv', url: `https://arxiv.org/abs/${id}`, snippet: abstract, ...(when ? { note: `preprint, ${when}` } : {}) })
    if (out.length === ARXIV_LIMIT) break
  }
  return out
}

/** Numbers the sources 1..n in the order given (web first). The Researcher cites these numbers. */
export function numberSources(...groups: RawSource[][]): Source[] {
  return groups.flat().map((source, i) => ({ ...source, n: i + 1 }))
}

/** The source block of the Researcher's message. Cut at a source boundary, never mid-source. */
export function sourcesPromptBlock(sources: Source[]): string {
  const blocks: string[] = []
  let used = 0
  for (const source of sources) {
    const block = `[${source.n}] ${source.site}: ${source.title}\n${capText(source.snippet, MAX_SNIPPET_CHARS)}`
    if (used + block.length > MAX_PROMPT_SOURCES_CHARS) break
    blocks.push(block)
    used += block.length
  }
  return blocks.join('\n\n')
}

class RetrieveError extends Error {}

/** Reads a body as text, refusing more than MAX_RESPONSE_BYTES. */
async function readText(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length') ?? '0') > MAX_RESPONSE_BYTES) throw new RetrieveError('sent too much data')
  const reader = response.body?.getReader()
  if (!reader) throw new RetrieveError('sent an empty reply')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new RetrieveError('sent too much data')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new RetrieveError('sent a reply that is not JSON')
  }
}

interface RequestOptions {
  /** A POST with a JSON body. Without it the request is a GET. */
  post?: { body: string; key: string }
  accept: 'application/json' | 'application/atom+xml'
  /** What an HTTP status means for this site, when it is more than "answered HTTP n". */
  explain?: (status: number) => string | undefined
}

/**
 * One request. A dropped connection (fetch throws a TypeError) is tried once more under the same
 * signal, since such drops are brief. A timeout, an HTTP error status or a bad body is not retried.
 */
async function fetchText(url: string, signal: AbortSignal, fetchImpl: typeof fetch, options: RequestOptions): Promise<string> {
  const { post, accept, explain } = options
  const init: RequestInit = {
    signal,
    headers: {
      Accept: accept,
      'User-Agent': USER_AGENT,
      ...(post ? { 'Content-Type': 'application/json', Authorization: `Bearer ${post.key}` } : {}),
    },
    ...(post ? { method: 'POST', body: post.body } : {}),
  }
  let response: Response
  try {
    response = await fetchImpl(url, init)
  } catch (err) {
    if (!(err instanceof TypeError) || signal.aborted) throw err
    response = await fetchImpl(url, init)
  }
  if (!response.ok) throw new RetrieveError(explain?.(response.status) ?? `answered HTTP ${response.status}`)
  return readText(response)
}

/** Tavily: 401/403 is a bad key, and 429 or its plan-limit statuses 432/433 mean the monthly credits are used up. */
function explainTavily(status: number): string | undefined {
  if (status === 401 || status === 403) return 'refused its key'
  if (status === 429 || status === 432 || status === 433) return 'over its monthly limit'
  return undefined
}

function failureReason(err: unknown): string {
  if (err instanceof RetrieveError) return err.message
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'did not answer in time'
  return 'could not be reached'
}

export interface RetrieveResult {
  sources: Source[]
  /** One plain sentence for the trace: what was found, or why nothing was. */
  detail: string
  /** True when at least one lookup answered, even if it found nothing. */
  reached: boolean
}

export interface RetrieveOptions {
  /** The run signal: the visitor leaving ends the lookups. */
  signal: AbortSignal
  timeoutMs?: number
  fetchImpl?: typeof fetch
  /** The Tavily key. Defaults to TAVILY_API_KEY. Without one the web search is named as not set up and the others carry on. */
  webKey?: string
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function describe(found: Array<[RawSource[], string]>, problems: string[], reached: boolean): string {
  const parts = found.filter(([sources]) => sources.length > 0).map(([sources, word]) => plural(sources.length, word))
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '')
  const trouble = problems.join('; ')
  if (list) return `Found ${list}.${trouble ? ` ${trouble}.` : ''}`
  if (!reached) return `No sources retrieved: ${trouble}.`
  return `No sources found for this question on the web, arXiv, Hacker News or Wikipedia.${trouble ? ` ${trouble}.` : ''}`
}

/**
 * Looks the question up on the web (Tavily), arXiv, Hacker News and Wikipedia in parallel. Each lookup has
 * its own deadline, so a slow site cannot hold the others. A lookup that fails is named in the detail and
 * the others still count. One relevance rule decides what each site's results are worth keeping. Nothing
 * is invented: no hits means an empty list.
 */
export async function retrieveSources(query: string, options: RetrieveOptions): Promise<RetrieveResult> {
  const { signal, timeoutMs = RETRIEVE_TIMEOUT_MS, fetchImpl = fetch, webKey = process.env.TAVILY_API_KEY } = options
  const terms = searchTerms(query)
  // The deadline covers the body read too: a site that sends headers and then stalls still ends at the limit.
  const get = (url: string, request: RequestOptions) => withDeadline(timeoutMs, signal, lookupSignal => fetchText(url, lookupSignal, fetchImpl, request))
  const getJson = async (url: string) => parseJson(await get(url, { accept: 'application/json' }))

  // Wikipedia gets the all-words request and an any-word one beside it: a long question finds no page that has every word.
  const wikipedia = async (): Promise<RawSource[]> => {
    const outcomes = await Promise.allSettled([getJson(wikipediaSearchUrl(terms)), getJson(wikipediaSearchUrl(terms, true))])
    const [exact, any] = outcomes
    if (exact?.status === 'rejected' && any?.status === 'rejected') throw exact.reason
    const pages = outcomes.flatMap(outcome => (outcome.status === 'fulfilled' ? parseWikipedia(outcome.value, terms) : []))
    return pages.filter((page, i) => pages.findIndex(other => other.url === page.url) === i).slice(0, WIKIPEDIA_LIMIT)
  }

  const lookups: Array<{ label: string; word: string; run: Promise<RawSource[]> | undefined }> = [
    {
      label: 'Web search',
      word: 'web page',
      run: webKey
        ? get(TAVILY_SEARCH_API, { accept: 'application/json', post: { body: tavilySearchBody(query), key: webKey }, explain: explainTavily }).then(text =>
            parseWebSearch(parseJson(text), terms),
          )
        : undefined,
    },
    { label: 'arXiv', word: 'arXiv paper', run: get(arxivSearchUrl(terms), { accept: 'application/atom+xml' }).then(xml => parseArxiv(xml, terms)) },
    { label: 'Hacker News', word: 'Hacker News thread', run: getJson(hnSearchUrl(terms)).then(body => parseHn(body, terms)) },
    { label: 'Wikipedia', word: 'Wikipedia article', run: wikipedia() },
  ]

  const outcomes = await Promise.allSettled(lookups.map(lookup => lookup.run ?? Promise.reject(new RetrieveError('is not set up on this server'))))
  const problems: string[] = []
  const found: Array<[RawSource[], string]> = []
  let answered = 0
  for (const [i, outcome] of outcomes.entries()) {
    const lookup = lookups[i]
    if (!lookup) continue
    if (outcome.status === 'fulfilled') {
      answered += 1
      found.push([outcome.value, lookup.word])
    } else {
      problems.push(`${lookup.label} ${failureReason(outcome.reason)}`)
      found.push([[], lookup.word])
    }
  }

  return {
    sources: numberSources(...found.map(([sources]) => sources)),
    detail: describe(found, problems, answered > 0),
    reached: answered > 0,
  }
}
