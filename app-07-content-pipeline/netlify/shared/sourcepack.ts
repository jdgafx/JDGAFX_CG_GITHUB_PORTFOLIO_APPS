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
const CITATION = / ?(?<![\w\]])((?:\[\d{1,2}\])+)/g

// Words that say nothing about a claim, so they never make a citation fit.
const FILLER = new Set([
  'the', 'and', 'for', 'are', 'was', 'not', 'but', 'you', 'all', 'can', 'has', 'had', 'its', 'our', 'out', 'who', 'how',
  'why', 'too', 'any', 'may', 'one', 'two', 'new', 'use', 'get', 'got', 'his', 'her', 'she', 'him', 'from', 'that', 'this',
  'with', 'have', 'been', 'were', 'also', 'more', 'most', 'such', 'than', 'into', 'about', 'over', 'only', 'many', 'other',
  'which', 'their', 'there', 'these', 'those', 'while', 'where', 'when', 'what', 'will', 'would', 'could', 'should',
  'being', 'both', 'each', 'some', 'them', 'they', 'then', 'very', 'just', 'like', 'make', 'makes', 'made', 'much', 'well',
  'even', 'still', 'often', 'every', 'because', 'between', 'through', 'after', 'before',
])

// A token is a word, or a name such as "asm.js", "node.js" or "c++". It is compared by its first
// four letters, so plurals and endings match; a name with a dot or plus is compared whole.
function stemOf(token: string): string {
  return /[.+]/.test(token) ? token : token.slice(0, 4)
}

// Three letters or more, no filler. A claim word is "rare" when it is a name with a dot, plus or
// digit, or a long word: one shared rare word is enough to back a claim, otherwise two are needed.
function claimWords(text: string): Map<string, boolean> {
  const words = new Map<string, boolean>()
  for (const token of text.toLowerCase().match(/[\p{L}\p{N}]+(?:\.[\p{L}\p{N}]+)*\+*/gu) ?? []) {
    if (token.length < 3 || FILLER.has(token)) continue
    words.set(stemOf(token), /[.+\d]/.test(token) || token.length >= 9)
  }
  return words
}

function sentenceBefore(text: string, index: number): string {
  const head = text.slice(0, index).replace(/(?: ?\[\d{1,2}\])+$/, '')
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('\n'))
  return head.slice(cut + 1)
}

// True when the sentence shares two claim words with the source's title or extract, or one rare
// one. The topic's own words are left out: every sentence about the topic has them.
function backs(source: Source, sentence: string, ignore: ReadonlySet<string>): boolean {
  const have = claimWords(`${source.title} ${source.summary}`)
  let shared = 0
  for (const [stem, rare] of claimWords(sentence)) {
    if (ignore.has(stem) || !have.has(stem)) continue
    if (rare) return true
    shared += 1
  }
  return shared >= 2
}

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
 * and so is a marker whose sentence shares too few claim words with its source (the sentence stays, uncited).
 * The list is built from the lookup, never from model text. With no sources the piece says so.
 * `topicTerms` are the topic's words, which do not count as a match.
 */
export function withSources(piece: string, pack: SourcePack, contentType: string, topicTerms: readonly string[] = []): string {
  const body = stripSourcesSection(piece).trimEnd()
  if (pack.sources.length === 0) {
    const unmarked = body.replace(CITATION, '')
    return `${unmarked}\n\n*No sources: the live lookups found nothing for this topic, so the facts above come from the model and are unchecked.*`
  }

  const bySource = new Map(pack.sources.map(source => [source.n, source]))
  const ignore = new Set(topicTerms.map(stemOf))
  const cited = new Set<number>()
  // A run such as "[1][2]" is judged marker by marker, and the markers that hold stay together.
  const cleaned = body.replace(CITATION, (match, run: string, offset: number) => {
    const sentence = sentenceBefore(body, offset)
    const kept = [...run.matchAll(/\[(\d+)\]/g)].flatMap(([marker, digits]) => {
      const source = bySource.get(Number(digits))
      if (!source || !backs(source, sentence, ignore)) return []
      cited.add(source.n)
      return [marker]
    })
    return kept.length > 0 ? `${match.startsWith(' ') ? ' ' : ''}${kept.join('')}` : ''
  })

  const listed = pack.sources.filter(source => cited.size === 0 || cited.has(source.n))
  const heading = cited.size === 0 ? 'Sources consulted (not cited in the text)' : 'Sources'
  const title = contentType === 'Social Thread' ? `**${heading}**` : `### ${heading}`
  return `${cleaned}\n\n${title}\n\n${listed.map(source => listEntry(source, contentType)).join('\n')}`
}
