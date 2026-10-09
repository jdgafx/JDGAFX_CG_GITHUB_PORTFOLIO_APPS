import type { Source } from '../../src/types'

/** Wikimedia asks API clients to identify themselves. */
const USER_AGENT = 'AgentFlow-demo/1.0 (https://jdgafx-app-01-multi-agent-orchestrator.netlify.app; portfolio demo)'

/** Both lookups run in parallel under this one ceiling. The run budget can shorten it. */
export const RETRIEVE_TIMEOUT_MS = 4_000
/** A reply larger than this is refused unread. Real replies are a few KB. */
const MAX_RESPONSE_BYTES = 200_000
/** Characters of one source passed to the model and shown on the page. */
export const MAX_SNIPPET_CHARS = 500
/** Characters of the whole source block in the Researcher's message. */
export const MAX_PROMPT_SOURCES_CHARS = 3_200
const WIKIPEDIA_LIMIT = 3
const HN_LIMIT = 2
const HN_MIN_POINTS = 20
const MAX_TERMS = 8
const MAX_TITLE_CHARS = 200

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php'
const HN_API = 'https://hn.algolia.com/api/v1/search'

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

export function wikipediaSearchUrl(terms: string): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: terms,
    gsrnamespace: '0',
    gsrlimit: String(WIKIPEDIA_LIMIT),
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    exchars: String(MAX_SNIPPET_CHARS),
    exlimit: String(WIKIPEDIA_LIMIT),
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

/** Parentheses are escaped too, so the link still parses inside markdown. */
export function wikipediaArticleUrl(title: string): string {
  const path = encodeURIComponent(title.replace(/ /g, '_')).replace(/\(/g, '%28').replace(/\)/g, '%29')
  return `https://en.wikipedia.org/wiki/${path}`
}

/** Articles in search rank order. A page without a title or without intro text is dropped. */
export function parseWikipedia(body: unknown): RawSource[] {
  const pages = isRecord(body) && isRecord(body.query) && Array.isArray(body.query.pages) ? body.query.pages : []
  const ranked: Array<{ index: number; source: RawSource }> = []
  for (const page of pages) {
    if (!isRecord(page)) continue
    const title = typeof page.title === 'string' ? capText(page.title, MAX_TITLE_CHARS) : ''
    const extract = typeof page.extract === 'string' ? capText(page.extract, MAX_SNIPPET_CHARS) : ''
    if (!title || !extract) continue
    const index = typeof page.index === 'number' ? page.index : Number.MAX_SAFE_INTEGER
    ranked.push({ index, source: { title, site: 'Wikipedia', url: wikipediaArticleUrl(title), snippet: extract } })
  }
  return ranked
    .sort((a, b) => a.index - b.index)
    .slice(0, WIKIPEDIA_LIMIT)
    .map(entry => entry.source)
}

function monthYear(iso: string): string | undefined {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return undefined
  return new Date(time).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
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

/** Search words a story title must carry: 60% of them, at most three. Loose matches are dropped. */
function hnWordsNeeded(termCount: number): number {
  return Math.min(3, Math.ceil(termCount * 0.6))
}

/**
 * Hacker News stories that match the question. The link is always the discussion page, built
 * from a numeric id. A hit whose title does not carry enough of the search words is dropped.
 */
export function parseHn(body: unknown, terms: string): RawSource[] {
  const hits = isRecord(body) && Array.isArray(body.hits) ? body.hits : []
  const needed = hnWordsNeeded(terms.split(' ').filter(Boolean).length)
  const out: RawSource[] = []
  for (const hit of hits) {
    if (!isRecord(hit)) continue
    const title = typeof hit.title === 'string' ? capText(hit.title, MAX_TITLE_CHARS) : ''
    const id = typeof hit.objectID === 'string' && /^\d{1,12}$/.test(hit.objectID) ? hit.objectID : ''
    const points = typeof hit.points === 'number' && Number.isFinite(hit.points) ? hit.points : undefined
    if (!title || !id || points === undefined || points < HN_MIN_POINTS) continue

    const highlight = isRecord(hit._highlightResult) && isRecord(hit._highlightResult.title) ? hit._highlightResult.title : {}
    const matched = Array.isArray(highlight.matchedWords) ? highlight.matchedWords.length : 0
    if (matched < needed) continue

    const comments = typeof hit.num_comments === 'number' && Number.isFinite(hit.num_comments) ? hit.num_comments : 0
    const when = typeof hit.created_at === 'string' ? monthYear(hit.created_at) : undefined
    const host = httpsHost(hit.url)
    const note = [`${points.toLocaleString('en-US')} points`, `${comments.toLocaleString('en-US')} comments`, when]
      .filter(Boolean)
      .join(', ')
    out.push({
      title,
      site: 'Hacker News',
      url: `https://news.ycombinator.com/item?id=${id}`,
      snippet: capText(`Hacker News story "${title}"${host ? `, linking to ${host}` : ''}. ${note}.`, MAX_SNIPPET_CHARS),
      note,
    })
    if (out.length === HN_LIMIT) break
  }
  return out
}

/** Numbers the sources 1..n, Wikipedia first. The Researcher cites these numbers. */
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

/** Reads a JSON body, refusing more than MAX_RESPONSE_BYTES. */
async function readJson(response: Response): Promise<unknown> {
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
  const text = new TextDecoder().decode(Buffer.concat(chunks))
  try {
    return JSON.parse(text)
  } catch {
    throw new RetrieveError('sent a reply that is not JSON')
  }
}

/**
 * One request. A dropped connection (fetch throws a TypeError) is tried once more under the same
 * signal, since such drops are brief. A timeout, an HTTP error status or a bad body is not retried.
 */
async function fetchJson(url: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<unknown> {
  const init = { signal, headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } }
  let response: Response
  try {
    response = await fetchImpl(url, init)
  } catch (err) {
    if (!(err instanceof TypeError) || signal.aborted) throw err
    response = await fetchImpl(url, init)
  }
  if (!response.ok) throw new RetrieveError(`answered HTTP ${response.status}`)
  return readJson(response)
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
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function describe(wiki: RawSource[], hn: RawSource[], problems: string[]): string {
  const found = [
    wiki.length > 0 ? `${plural(wiki.length, 'Wikipedia article')}` : '',
    hn.length > 0 ? `${plural(hn.length, 'Hacker News thread')}` : '',
  ].filter(Boolean)
  const trouble = problems.join('; ')
  if (found.length > 0) return `Found ${found.join(' and ')}.${trouble ? ` ${trouble}.` : ''}`
  if (trouble) return `No sources retrieved: ${trouble}.`
  return 'No sources found for this question on Wikipedia or Hacker News.'
}

/**
 * Looks the question up on Wikipedia and Hacker News in parallel. Each lookup has its own
 * AbortSignal.timeout, so a slow source cannot hold the other. A lookup that fails is named in the
 * detail and the other one still counts. Nothing is invented: no hits means an empty list.
 */
export async function retrieveSources(query: string, options: RetrieveOptions): Promise<RetrieveResult> {
  const { signal, timeoutMs = RETRIEVE_TIMEOUT_MS, fetchImpl = fetch } = options
  const terms = searchTerms(query)
  const lookup = (url: string) => fetchJson(url, AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), fetchImpl)

  const [wikiOutcome, hnOutcome] = await Promise.allSettled([lookup(wikipediaSearchUrl(terms)), lookup(hnSearchUrl(terms))])
  const problems: string[] = []
  let wiki: RawSource[] = []
  let hn: RawSource[] = []

  if (wikiOutcome.status === 'fulfilled') wiki = parseWikipedia(wikiOutcome.value)
  else problems.push(`Wikipedia ${failureReason(wikiOutcome.reason)}`)
  if (hnOutcome.status === 'fulfilled') hn = parseHn(hnOutcome.value, terms)
  else problems.push(`Hacker News ${failureReason(hnOutcome.reason)}`)

  return {
    sources: numberSources(wiki, hn),
    detail: describe(wiki, hn, problems),
    reached: problems.length < 2,
  }
}
