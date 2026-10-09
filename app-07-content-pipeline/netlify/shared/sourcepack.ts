// The Sources stage output: a numbered list of live public sources as plain text. The text is
// what later stages read and what the page parses back into cards, so the format is fixed here.
// Pure and shared with the browser.

export type SourceKind = 'wikipedia' | 'hackernews'

export const KIND_LABELS: Record<SourceKind, string> = { wikipedia: 'Wikipedia', hackernews: 'Hacker News' }

export interface Source {
  n: number
  kind: SourceKind
  title: string
  url: string
  // Plain-text extract. Empty for Hacker News, which gives a headline, not text.
  summary: string
  points?: number
  date?: string
}

export interface SourcePack {
  sources: Source[]
  // Plain sentences on what a lookup did not deliver: timeouts, empty results, skipped sites.
  notes: string[]
}

const KIND_BY_LABEL: Record<string, SourceKind> = { 'Wikipedia': 'wikipedia', 'Hacker News': 'hackernews' }
const BLOCK_START = /^\[(\d+)\] (Wikipedia|Hacker News): (.+)$/
const NO_SOURCES_LINE = 'No live sources were found for this topic.'

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

export function formatSourcePack(pack: SourcePack): string {
  const blocks = pack.sources.map(source => [
    `[${source.n}] ${KIND_LABELS[source.kind]}: ${oneLine(source.title)}`,
    `URL: ${source.url}`,
    source.points === undefined ? '' : `Points: ${source.points}`,
    source.date ? `Date: ${source.date}` : '',
    source.summary ? `Summary: ${oneLine(source.summary)}` : '',
  ].filter(Boolean).join('\n'))
  const notes = pack.notes.map(note => `Note: ${oneLine(note)}`).join('\n')
  return [pack.sources.length === 0 ? NO_SOURCES_LINE : '', ...blocks, notes].filter(Boolean).join('\n\n')
}

// Reads the text back. Anything that does not match the format is ignored, so edited or
// older text yields fewer sources, never invented ones. Only http(s) links are kept.
export function parseSourcePack(text: string): SourcePack {
  const sources: Source[] = []
  const notes: string[] = []
  let current: Source | null = null

  for (const line of text.split('\n')) {
    const start = BLOCK_START.exec(line)
    if (start) {
      current = { n: Number(start[1]), kind: KIND_BY_LABEL[start[2] ?? ''] ?? 'wikipedia', title: start[3] ?? '', url: '', summary: '' }
      sources.push(current)
    } else if (line.startsWith('Note: ')) {
      notes.push(line.slice(6))
      current = null
    } else if (current) {
      if (line.startsWith('URL: ')) current.url = line.slice(5).trim()
      else if (line.startsWith('Summary: ')) current.summary = line.slice(9)
      else if (line.startsWith('Date: ')) current.date = line.slice(6).trim()
      else if (line.startsWith('Points: ')) {
        const points = Number(line.slice(8))
        if (Number.isFinite(points)) current.points = points
      }
    }
  }
  return { sources: sources.filter(source => isHttpUrl(source.url)), notes }
}

// Number and title only, for the stages that must keep citations valid but do not need the extracts.
export function sourceIndex(pack: SourcePack): string {
  return pack.sources.map(source => `[${source.n}] ${KIND_LABELS[source.kind]}: ${oneLine(source.title)}`).join('\n')
}

// A model-written source list is cut off; the real list is built from the lookup instead.
const SOURCES_HEADING = /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:sources|references)\s*:?\s*(?:\*\*|__)?\s*$/i
const MAX_MODEL_LIST_LINES = 14

function stripSourcesSection(text: string): string {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (SOURCES_HEADING.test(lines[i] ?? '')) {
      return lines.length - i <= MAX_MODEL_LIST_LINES ? lines.slice(0, i).join('\n').trimEnd() : text
    }
  }
  return text
}

// A marker is "[n]" not glued to a word, so array[0] in code is left alone.
const CITATION = / ?(?<![\w\]])\[(\d{1,2})\]/g

function escapeMarkdown(text: string): string {
  return oneLine(text).replace(/([\\[\]*_`<>])/g, '\\$1')
}

const SHORT_LINK_CHARS = 56

function shortLink(url: string): string {
  const { host, pathname } = new URL(url)
  let path = pathname === '/' ? '' : pathname.replace(/\/$/, '')
  try {
    path = decodeURIComponent(path)
  } catch {
    // A malformed escape stays as it is.
  }
  const text = `${host.replace(/^www\./, '')}${path}`
  return text.length > SHORT_LINK_CHARS ? `${text.slice(0, SHORT_LINK_CHARS - 1)}…` : text
}

function listEntry(source: Source, contentType: string): string {
  if (contentType === 'Social Thread') {
    return `- [${source.n}] [${escapeMarkdown(shortLink(source.url))}](${source.url})`
  }
  const meta = [
    KIND_LABELS[source.kind],
    source.points === undefined ? '' : `${source.points} points`,
    source.date ?? '',
  ].filter(Boolean).join(', ')
  return `- [${source.n}] [${escapeMarkdown(source.title)}](${source.url}), ${meta}`
}

/**
 * Ends the finished piece with its Sources list. Markers that point at no real source are removed,
 * and the list is built from the lookup, never from model text. With no sources the piece says so.
 */
export function withSources(piece: string, pack: SourcePack, contentType: string): string {
  const body = stripSourcesSection(piece).trimEnd()
  if (pack.sources.length === 0) {
    const unmarked = body.replace(CITATION, '')
    return `${unmarked}\n\n*No sources: the live lookups found nothing for this topic, so the facts above come from the model and are unchecked.*`
  }

  const known = new Set(pack.sources.map(source => source.n))
  const cited = new Set<number>()
  const cleaned = body.replace(CITATION, (marker, digits: string) => {
    const n = Number(digits)
    if (!known.has(n)) return ''
    cited.add(n)
    return marker
  })

  const listed = pack.sources.filter(source => cited.size === 0 || cited.has(source.n))
  const heading = cited.size === 0 ? 'Sources consulted (not cited in the text)' : 'Sources'
  const title = contentType === 'Social Thread' ? `**${heading}**` : `### ${heading}`
  return `${cleaned}\n\n${title}\n\n${listed.map(source => listEntry(source, contentType)).join('\n')}`
}
