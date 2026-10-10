// Live public sources for a topic: Wikipedia articles and Hacker News stories. The URL builders
// and parsers are pure; gatherSources is the only function that touches the network.
import { withDeadline } from './deadline'
import { isHttpUrl, type Source, type SourcePack } from './sourcepack'

export const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php'
export const HACKER_NEWS_API = 'https://hn.algolia.com/api/v1/search'

// The Sources lookups run in parallel under this one cap, so the stage stays well inside the limit.
export const SOURCES_TIMEOUT_MS = 5_000

const USER_AGENT = 'ContentForge/1.0 (https://jdgafx-app-07-content-pipeline.netlify.app)'
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

// Words that describe the kind of thing, not the thing. Hacker News matches stories on every query word, and the fallback
// below only runs when nothing matches at all. The five-word query "rust programming language memory safety" returned four
// stories with 20+ points, and none of their titles named memory safety. Wikipedia keeps these words: they pick the right
// article ("Rust (programming language)", not the oxide).
const HN_FILLER = new Set(['programming', 'language', 'languages', 'software', 'technology', 'technologies'])

// The terms for a Hacker News lookup: the topic's words without the filler, or all of them when only filler is left.
export function hackerNewsTerms(terms: string[]): string[] {
  const kept = terms.filter(term => !HN_FILLER.has(term))
  return kept.length > 0 ? kept : terms
}

export function hackerNewsUrl(terms: string[]): string {
  const params = new URLSearchParams({
    query: terms.join(' '),
    tags: 'story',
    hitsPerPage: String(HACKER_NEWS_CANDIDATES),
    numericFilters: `points>=${MIN_POINTS}`,
    // Only a query with no hits at all falls back to ranking stories by how many of its words they match.
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

// How many topic words appear in the text. A word matches by its first four letters, so plurals
// and endings still count.
export function topicHits(text: string, terms: string[]): number {
  const lower = text.toLowerCase()
  return terms.filter(term => lower.includes(term.slice(0, 4))).length
}

// A lifespan in brackets in the opening line, as in "James Edwin Webb (October 7, 1906 - March 27, 1992) was".
const PERSON_LEAD = /^[^.]{0,160}\((?:born\b[^)]*\d{4}|[^)]*\d{4}\s*[\u2013\u2014-]\s*[^)]*\d{4})\)/

export function isPersonLead(summary: string): boolean {
  return PERSON_LEAD.test(summary)
}

/**
 * Picks the articles that are about the topic. The title must share a topic word, the opening must
 * share about half of them, and a person's page is kept only when the best search hit is a person
 * too (so "James Webb Space Telescope" does not bring in the man it is named after). Articles whose
 * titles cover more of the topic come first; search rank breaks ties.
 */
export function parseWikipedia(json: unknown, terms: string[]): Candidate[] {
  const pages = asRecord(asRecord(json)?.query)?.pages
  if (!Array.isArray(pages)) return []
  const found: Array<{ index: number; titleHits: number; person: boolean; leadHits: number; candidate: Candidate }> = []
  for (const page of pages) {
    const record = asRecord(page)
    const title = record?.title
    const extract = record?.extract
    if (typeof title !== 'string' || typeof extract !== 'string') continue
    const summary = clipExtract(extract, EXTRACT_CHARS)
    // A stub or a disambiguation page gives a writer nothing to cite.
    if (summary.length < MIN_EXTRACT_CHARS || /\bmay (?:also )?refer to\b/i.test(summary)) continue
    found.push({
      index: typeof record?.index === 'number' ? record.index : Number.MAX_SAFE_INTEGER,
      titleHits: topicHits(title, terms),
      leadHits: topicHits(summary, terms),
      person: isPersonLead(summary),
      candidate: { kind: 'wikipedia', title, url: wikipediaPageUrl(title), summary },
    })
  }
  found.sort((a, b) => a.index - b.index)
  const topicIsPerson = found[0]?.person ?? false
  const minLeadHits = Math.ceil(terms.length / 2)
  return found
    .filter(page => terms.length === 0 || (page.titleHits >= 1 && page.leadHits >= minLeadHits))
    .filter(page => topicIsPerson || !page.person)
    .sort((a, b) => b.titleHits - a.titleHits || a.index - b.index)
    .slice(0, MAX_WIKIPEDIA)
    .map(page => page.candidate)
}

// A story must share about half the topic words with its title (at most three, at least one), so
// Hacker News only appears when the topic is something it actually discusses.
export function isRelevantTitle(title: string, terms: string[]): boolean {
  return topicHits(title, terms) >= Math.max(1, Math.min(3, Math.ceil(terms.length / 2)))
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
  // True when the lookup errored or hit its cap. A lookup that answered with no match is not a failure.
  failed: boolean
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
    return items.length > 0 ? { items, failed: false } : { items, note: `${name} returned no matching results.`, failed: false }
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return { items: [], note: `${name} ${timedOut ? 'did not answer in time' : 'was unavailable'}.`, failed: true }
  }
}

// Thrown when a lookup failed and no source is left to cite. The Sources stage then fails: the writing never
// starts from memory in place of a lookup that could not be reached.
export class SourcesUnavailableError extends Error {
  constructor(readonly notes: string[]) {
    super('No live source could be reached.')
    this.name = 'SourcesUnavailableError'
  }
}

/**
 * Looks the topic up on Wikipedia and (for most content types) Hacker News, in parallel, under one
 * deadline that carries the total time cap. A lookup that fails adds a note, and the pack holds
 * whatever the other lookup found. A lookup that answers with no match leaves an empty pack that says
 * so. Only when a lookup failed and no source is left does it throw SourcesUnavailableError.
 */
export async function gatherSources(
  topic: string,
  contentType: string,
  parent: AbortSignal,
  timeoutMs = SOURCES_TIMEOUT_MS,
): Promise<SourcePack> {
  const terms = searchTerms(topic)
  const hnTerms = hackerNewsTerms(terms)
  const [wikipedia, hackerNews] = await Promise.all([
    lookup('Wikipedia', parent, timeoutMs, async signal => parseWikipedia(await fetchJson(wikipediaUrl(terms), signal), terms)),
    searchesHackerNews(contentType)
      ? lookup('Hacker News', parent, timeoutMs, async signal => parseHackerNews(await fetchJson(hackerNewsUrl(hnTerms), signal), hnTerms))
      : Promise.resolve<Lookup>({ items: [], note: 'Hacker News is not searched for marketing copy.', failed: false }),
  ])
  const found = [...wikipedia.items, ...hackerNews.items]
  const notes = [wikipedia.note, hackerNews.note].filter((note): note is string => Boolean(note))
  if (found.length === 0 && (wikipedia.failed || hackerNews.failed)) throw new SourcesUnavailableError(notes)
  return {
    sources: found.map((item, i) => ({ ...item, n: i + 1 })),
    notes,
  }
}
