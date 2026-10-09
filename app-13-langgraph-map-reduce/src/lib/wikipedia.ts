import { LOADER_MAX_CHARS, MIN_CHARS } from './limits'

/**
 * Pure helpers for the Wikipedia loader: the request URLs, reading the API's replies, and turning an
 * article's plain text into a document the analysis accepts. The network calls live in wikipedia-api.ts.
 * en.wikipedia.org/w/api.php answers browser requests when origin=* is set, so no server hop is needed.
 */

const API = 'https://en.wikipedia.org/w/api.php'

/** Three articles to try. Only titles are kept here, the text is fetched live. Rubber duck fits whole under the loader limit, the others are trimmed to it. */
export const SUGGESTED_TITLES = ['Apollo 11', 'Photosynthesis', 'Rubber duck'] as const

/** What the visitor gets from a successful load. */
export interface Article {
  /** The resolved title, after redirects. */
  title: string
  url: string
  /** The cleaned text, at most LOADER_MAX_CHARS. */
  text: string
  /** Length of the cleaned article before trimming. */
  originalChars: number
  trimmed: boolean
}

export type WikiErrorKind = 'network' | 'timeout' | 'unavailable' | 'bad_response' | 'not_found' | 'disambiguation' | 'too_short'

/** A failed load, with a message fit to show as it is. Only the first four kinds are worth a retry. */
export class WikiError extends Error {
  readonly kind: WikiErrorKind
  constructor(kind: WikiErrorKind, message: string) {
    super(message)
    this.name = 'WikiError'
    this.kind = kind
  }
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'unavailable' || this.kind === 'bad_response'
  }
}

/** What one extract reply says about the page asked for. */
export type PageRead =
  | { kind: 'ok'; title: string; url: string; extract: string }
  | { kind: 'missing'; title: string }
  | { kind: 'disambiguation'; title: string }
  | { kind: 'invalid' }

function params(values: Record<string, string>): string {
  return `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...values }).toString()}`
}

/** Title search for the suggestions under the input. Main namespace only, titles only. */
export function searchUrl(query: string, limit = 6): string {
  return params({ action: 'query', list: 'search', srsearch: query.trim(), srnamespace: '0', srlimit: String(limit), srprop: '' })
}

/** Plain-text extract of the whole article, following redirects, with the disambiguation flag and the canonical URL. */
export function extractUrl(title: string): string {
  return params({
    action: 'query',
    prop: 'extracts|pageprops|info',
    titles: title.trim(),
    explaintext: '1',
    redirects: '1',
    ppprop: 'disambiguation',
    inprop: 'url',
  })
}

/** The public address of an article, for the link shown beside the text. */
export function articleUrl(title: string): string {
  const slug = encodeURIComponent(title.trim().replace(/ /g, '_')).replace(/%28/g, '(').replace(/%29/g, ')').replace(/%2C/g, ',').replace(/%3A/g, ':')
  return `https://en.wikipedia.org/wiki/${slug}`
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Titles from a list=search reply. Anything unreadable gives an empty list. */
export function readSearch(json: unknown): string[] {
  const results = record(record(json)?.query)?.search
  if (!Array.isArray(results)) return []
  return results.flatMap((item) => {
    const title = record(item)?.title
    return typeof title === 'string' && title.trim() ? [title] : []
  })
}

/** Reads an extract reply for the single page it was asked about. */
export function readPage(json: unknown): PageRead {
  const pages = record(record(json)?.query)?.pages
  const page = Array.isArray(pages) ? record(pages[0]) : null
  if (!page || typeof page.title !== 'string') return { kind: 'invalid' }
  if (page.missing === true || page.invalid === true) return { kind: 'missing', title: page.title }
  if (record(page.pageprops)?.disambiguation !== undefined) return { kind: 'disambiguation', title: page.title }
  if (typeof page.extract !== 'string') return { kind: 'invalid' }
  const url = typeof page.fullurl === 'string' ? page.fullurl : articleUrl(page.title)
  return { kind: 'ok', title: page.title, url, extract: page.extract }
}

/** Sections at the end of an article that hold links and citations, not prose. */
const END_MATTER = new Set([
  'see also',
  'notes',
  'footnotes',
  'references',
  'citations',
  'sources',
  'bibliography',
  'further reading',
  'external links',
  'works cited',
])
const HEADING = /^(={2,6})\s*(.+?)\s*\1$/

/**
 * Turns an extract into paragraphs separated by one blank line. Section headings lose their = markers
 * and stay as short lines, and the end-matter sections (references, external links and the like) are
 * dropped with everything after the first of them.
 */
export function cleanExtract(raw: string): string {
  const paragraphs: string[] = []
  for (const line of raw.replace(/\r\n?/g, '\n').replace(/[\u200b\ufeff]/g, '').replace(/\u00a0/g, ' ').split('\n')) {
    const text = line.replace(/[ \t]+/g, ' ').trim()
    if (!text) continue
    const heading = HEADING.exec(text)
    if (heading?.[1] === '==' && END_MATTER.has((heading[2] ?? '').toLowerCase())) break
    paragraphs.push(heading ? (heading[2] ?? text) : text)
  }
  return paragraphs.join('\n\n')
}

/** A short line with no closing punctuation: a section heading left dangling at the end of a cut. */
function isHeading(paragraph: string): boolean {
  return paragraph.length <= 80 && !paragraph.includes('\n') && !/[.!?:;"”')\]]$/.test(paragraph)
}

function dropTrailingHeadings(text: string): string {
  let out = text
  for (;;) {
    const at = out.lastIndexOf('\n\n')
    if (at < 0 || !isHeading(out.slice(at + 2))) return out
    out = out.slice(0, at)
  }
}

/** The last sentence end at or before `limit`, as a cut position, or -1. */
function lastSentenceEnd(text: string, limit: number): number {
  let cut = -1
  for (const match of text.slice(0, limit + 1).matchAll(/[.!?]["”')\]]*(?=\s|$)/g)) cut = match.index + match[0].length
  return cut
}

/**
 * Cuts text to at most `max` characters on a paragraph boundary, dropping a section heading left
 * hanging at the end. If the first paragraph break is too early to be useful (under half the limit),
 * the cut falls on the last sentence end instead, and then on the last space.
 */
export function trimToLimit(text: string, max: number = LOADER_MAX_CHARS): { text: string; trimmed: boolean } {
  if (text.length <= max) return { text, trimmed: false }
  const paragraphEnd = text.slice(0, max + 2).lastIndexOf('\n\n')
  const sentenceEnd = lastSentenceEnd(text, max)
  const spaceEnd = text.slice(0, max + 1).lastIndexOf(' ')
  const cut = paragraphEnd >= max / 2 ? paragraphEnd : sentenceEnd >= max / 2 ? sentenceEnd : spaceEnd > 0 ? spaceEnd : max
  return { text: dropTrailingHeadings(text.slice(0, cut).trimEnd()), trimmed: true }
}

/** Builds the article the visitor gets, or throws the error to show. The 200-character floor applies to the cleaned, trimmed text. */
export function buildArticle(page: Extract<PageRead, { kind: 'ok' }>): Article {
  const cleaned = cleanExtract(page.extract)
  const { text, trimmed } = trimToLimit(cleaned)
  if (text.length < MIN_CHARS) {
    throw new WikiError(
      'too_short',
      `"${page.title}" has only ${text.length} characters of text. The analysis needs at least ${MIN_CHARS}, so try a longer article.`,
    )
  }
  return { title: page.title, url: page.url, text, originalChars: cleaned.length, trimmed }
}
