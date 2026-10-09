// Live public sources for a topic: Wikipedia articles and Hacker News stories. The URL builders
// and parsers are pure; gatherSources is the only function that touches the network.
import { withDeadline } from './deadline'
import { isHttpUrl, type Source, type SourcePack } from './sourcepack'

export const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php'
export const HACKER_NEWS_API = 'https://hn.algolia.com/api/v1/search'

// The Sources lookups run in parallel under this one cap, so the stage stays well inside the limit.
export const SOURCES_TIMEOUT_MS = 4_000

const USER_AGENT = 'ContentForge/1.0 (https://jdgafx-app-07-content-pipeline.netlify.app; portfolio demo)'
// A lookup answer larger than this is refused; real answers are a few kilobytes.
const MAX_RESPONSE_BYTES = 256 * 1024

const MAX_TERMS = 6
const MAX_WIKIPEDIA = 3
const MAX_HACKER_NEWS = 3
const WIKIPEDIA_CANDIDATES = 5
const HACKER_NEWS_CANDIDATES = 12
const EXTRACT_CHARS = 520
const MIN_EXTRACT_CHARS = 80
const MIN_POINTS = 20
const HN_HOMEPAGE = 'https://news.ycombinator.com/item?id='

type Candidate = Omit<Source, 'n'>

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'in', 'is', 'it',
  'its', 'of', 'on', 'or', 'our', 'that', 'the', 'their', 'this', 'to', 'was', 'what', 'when', 'where', 'which',
  'who', 'why', 'will', 'with', 'you', 'your', 'about', 'into', 'than', 'then', 'they', 'should', 'would',
  'achieve', 'achieves', 'matter', 'matters', 'guide', 'tips', 'using', 'explained', 'introduction',
])

// The meaningful words of a topic, in order, without repeats. Falls back to the raw topic when
// every word is a stopword.
export function searchTerms(topic: string): string[] {
  const words = topic.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.'-]*/gu) ?? []
  const terms = [...new Set(words.map(word => word.replace(/[.'-]+$/, '')).filter(word => word.length > 1 && !STOPWORDS.has(word)))]
  return terms.length > 0 ? terms.slice(0, MAX_TERMS) : [topic.trim().toLowerCase()].filter(Boolean)
}

// One request returns the search hits and their introductions together.
export function wikipediaUrl(terms: string[]): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: terms.join(' '),
    gsrnamespace: '0',
    gsrlimit: String(WIKIPEDIA_CANDIDATES),
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    exlimit: String(WIKIPEDIA_CANDIDATES),
    exchars: String(EXTRACT_CHARS + 80),
  })
  return `${WIKIPEDIA_API}?${params}`
}

export function hackerNewsUrl(terms: string[]): string {
  const params = new URLSearchParams({
    query: terms.join(' '),
    tags: 'story',
    hitsPerPage: String(HACKER_NEWS_CANDIDATES),
    numericFilters: `points>=${MIN_POINTS}`,
    // With no story containing every word, Algolia ranks by how many words match instead of returning nothing.
    removeWordsIfNoResults: 'allOptional',
    attributesToRetrieve: 'title,url,points,created_at,objectID',
  })
  return `${HACKER_NEWS_API}?${params}`
}

// Parentheses are encoded so a title such as "Rust (programming language)" cannot end a Markdown link early.
export function wikipediaPageUrl(title: string): string {
  const path = encodeURIComponent(title.replace(/ /g, '_')).replace(/\(/g, '%28').replace(/\)/g, '%29')
  return `https://en.wikipedia.org/wiki/${path}`
}

// Cuts at the last full sentence inside the limit, or at a word with an ellipsis when there is none.
export function clipExtract(text: string, limit: number): string {
  const plain = text.replace(/\s+/g, ' ').trim()
  if (plain.length <= limit && /[.!?)"'”]$/.test(plain)) return plain
  const head = plain.slice(0, limit)
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  if (sentenceEnd > limit / 2) return head.slice(0, sentenceEnd + 1)
  const lastSpace = head.lastIndexOf(' ')
  return `${(lastSpace > limit / 2 ? head.slice(0, lastSpace) : head).trimEnd()}…`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function parseWikipedia(json: unknown): Candidate[] {
  const pages = asRecord(asRecord(json)?.query)?.pages
  if (!Array.isArray(pages)) return []
  const ranked: Array<{ index: number; candidate: Candidate }> = []
  for (const page of pages) {
    const record = asRecord(page)
    const title = record?.title
    const extract = record?.extract
    if (typeof title !== 'string' || typeof extract !== 'string') continue
    const summary = clipExtract(extract, EXTRACT_CHARS)
    // A stub or a disambiguation page gives a writer nothing to cite.
    if (summary.length < MIN_EXTRACT_CHARS || /\bmay (?:also )?refer to\b/i.test(summary)) continue
    const index = typeof record?.index === 'number' ? record.index : Number.MAX_SAFE_INTEGER
    ranked.push({ index, candidate: { kind: 'wikipedia', title, url: wikipediaPageUrl(title), summary } })
  }
  return ranked.sort((a, b) => a.index - b.index).slice(0, MAX_WIKIPEDIA).map(entry => entry.candidate)
}

// A story must share about half the topic words with its title (at most three, at least one), so
// Hacker News only appears when the topic is something it actually discusses.
export function isRelevantTitle(title: string, terms: string[]): boolean {
  const lower = title.toLowerCase()
  const hits = terms.filter(term => lower.includes(term.slice(0, 4))).length
  return hits >= Math.max(1, Math.min(3, Math.ceil(terms.length / 2)))
}

export function parseHackerNews(json: unknown, terms: string[]): Candidate[] {
  const hits = asRecord(json)?.hits
  if (!Array.isArray(hits)) return []
  const seen = new Set<string>()
  const stories: Candidate[] = []
  for (const hit of hits) {
    const record = asRecord(hit)
    const title = typeof record?.title === 'string' ? record.title.replace(/\s+/g, ' ').trim() : ''
    const points = record?.points
    if (!title || typeof points !== 'number' || points < MIN_POINTS || !isRelevantTitle(title, terms)) continue

    const link = typeof record?.url === 'string' && isHttpUrl(record.url) ? record.url : null
    const id = typeof record?.objectID === 'string' && /^\d+$/.test(record.objectID) ? record.objectID : null
    const url = link ?? (id ? `${HN_HOMEPAGE}${id}` : null)
    if (!url || seen.has(url)) continue
    seen.add(url)

    const created = typeof record?.created_at === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(record.created_at)?.[0] : undefined
    stories.push({ kind: 'hackernews', title, url, summary: '', points, ...(created ? { date: created } : {}) })
  }
  return stories.sort((a, b) => (b.points ?? 0) - (a.points ?? 0)).slice(0, MAX_HACKER_NEWS)
}

// Hacker News is a technology forum; it is not searched for marketing copy.
export function searchesHackerNews(contentType: string): boolean {
  return contentType !== 'Marketing Copy'
}

class LookupError extends Error {}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new LookupError('answer too large')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

// Redirects are refused so a lookup cannot be sent to another host.
async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, redirect: 'error', headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new LookupError(`HTTP ${response.status}`)
  }
  return JSON.parse(await readCapped(response)) as unknown
}

interface Lookup {
  items: Candidate[]
  note?: string
}

async function lookup(
  name: string,
  parent: AbortSignal,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<Candidate[]>,
): Promise<Lookup> {
  try {
    // The deadline covers the body read too, so a source that stalls after its headers still ends at the limit.
    const items = await withDeadline(timeoutMs, parent, run)
    return items.length > 0 ? { items } : { items, note: `${name} returned no matching results.` }
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return { items: [], note: `${name} ${timedOut ? 'did not answer in time' : 'was unavailable'}.` }
  }
}

/**
 * Looks the topic up on Wikipedia and (for most content types) Hacker News, in parallel, under one
 * deadline that carries the total time cap. A lookup that fails adds a note and never throws: the
 * pack then holds fewer sources, or none, and says why.
 */
export async function gatherSources(
  topic: string,
  contentType: string,
  parent: AbortSignal,
  timeoutMs = SOURCES_TIMEOUT_MS,
): Promise<SourcePack> {
  const terms = searchTerms(topic)
  const [wikipedia, hackerNews] = await Promise.all([
    lookup('Wikipedia', parent, timeoutMs, async signal => parseWikipedia(await fetchJson(wikipediaUrl(terms), signal))),
    searchesHackerNews(contentType)
      ? lookup('Hacker News', parent, timeoutMs, async signal => parseHackerNews(await fetchJson(hackerNewsUrl(terms), signal), terms))
      : Promise.resolve<Lookup>({ items: [], note: 'Hacker News is not searched for marketing copy.' }),
  ])
  return {
    sources: [...wikipedia.items, ...hackerNews.items].map((item, i) => ({ ...item, n: i + 1 })),
    notes: [wikipedia.note, hackerNews.note].filter((note): note is string => Boolean(note)),
  }
}
