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

/**
 * The finished piece without the Sources list that withSources appended, so the text can be compared
 * with the stage before it. Text with no such list comes back unchanged.
 */
export function bodyOf(piece: string): string {
  const cut = piece.search(/\n\n(?:### Sources(?: consulted \(not cited in the text\))?|\*\*Sources(?: consulted \(not cited in the text\))?\*\*)\n\n- \[\d+\]/)
  if (cut >= 0) return piece.slice(0, cut)
  const none = piece.indexOf('\n\n*No sources: the live lookups found nothing')
  return none >= 0 ? piece.slice(0, none) : piece
}

/**
 * The sources the appended list names, in order, and whether the list is a "consulted, not cited"
 * one. Empty when the piece ends without a list (no sources found).
 */
export function listedSources(piece: string, pack: SourcePack): { sources: Source[]; cited: boolean } {
  const tail = piece.slice(bodyOf(piece).length)
  const numbers = [...tail.matchAll(/^- \[(\d+)\] /gm)].map(match => Number(match[1]))
  return {
    sources: numbers.flatMap(n => pack.sources.filter(source => source.n === n)),
    cited: !tail.includes('(not cited in the text)'),
  }
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

// A token is a word, a number or a year, or a name such as "asm.js", "c++", "c#" or ".net".
// Filler words never count as a shared word.
function claimTokens(text: string): string[] {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+(?:\.[\p{L}\p{N}]+)*[+#]*/gu) ?? []
  return tokens.filter(token => !FILLER.has(token) && (token.length >= 3 || /[\d+#]/.test(token)))
}

// Two tokens are related when they are equal, or when both are at least four letters and one
// starts with the other's first four letters, or when one of at least five letters sits inside
// the other ("painting" in "repainting"). Short tokens such as "c#" and "lhc" must match exactly.
function related(a: string, b: string): boolean {
  if (a === b) return true
  const shortest = Math.min(a.length, b.length)
  if (shortest < 4 || /[.+#\d]/.test(a + b)) return false
  return a.slice(0, 4) === b.slice(0, 4) || (shortest >= 5 && (a.includes(b) || b.includes(a)))
}

// Strips the emoji, symbols and punctuation that trail a sentence before the marker, then returns
// the sentence they ended, so "...on the Moon. \u{1F315} [1]" is judged on "...on the Moon".
function sentenceBefore(text: string, index: number): string {
  const head = text.slice(0, index)
    .replace(/(?: ?\[\d{1,2}\])+$/, '')
    .replace(/(?:[\s\p{P}\p{S}\p{Extended_Pictographic}]|\u200D|\uFE0F)+$/u, '')
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('\n'))
  return head.slice(cut + 1)
}

// The words in a story's link ("margaret-hamilton-apollo-11-tribute") say what it is about when
// its headline does not name the subject.
function linkWords(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/[/_-]+/g, ' ')
  } catch {
    return ''
  }
}

// The tokens a source can back a claim with: title, extract and (for Hacker News) year and link words.
function sourceTokens(source: Source): string[] {
  const own = `${source.title} ${source.summary} ${source.date ?? ''}`
  return claimTokens(source.kind === 'hackernews' ? `${own} ${linkWords(source.url)}` : own)
}

// How well each source matches a sentence. A sentence token that relates to several sources is shared
// out between them, so a topic word every source has counts for little and a word only one source has
// counts in full. A source with no related token scores 0: there is no connection at all.
function matchScores(sentence: string, sources: Source[], tokensOf: Map<number, string[]>): Map<number, number> {
  const scores = new Map(sources.map(source => [source.n, 0]))
  for (const token of new Set(claimTokens(sentence))) {
    const matching = sources.filter(source => (tokensOf.get(source.n) ?? []).some(other => related(token, other)))
    for (const source of matching) scores.set(source.n, (scores.get(source.n) ?? 0) + 1 / matching.length)
  }
  return scores
}

// A rival is clearly better when it scores at least twice as much and at least one whole word more.
function clearlyBetter(rival: number, cited: number): boolean {
  return rival >= cited * 2 && rival - cited >= 1
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
 * and so is a marker whose sentence shares no word at all with its source (the sentence stays, uncited).
 * The list is built from the lookup, never from model text. With no sources the piece says so.
 */
export function withSources(piece: string, pack: SourcePack, contentType: string): string {
  const body = stripSourcesSection(piece).trimEnd()
  if (pack.sources.length === 0) {
    const unmarked = body.replace(CITATION, '')
    return `${unmarked}\n\n*No sources: the live lookups found nothing for this topic, so the facts above come from the model and are unchecked.*`
  }

  const bySource = new Map(pack.sources.map(source => [source.n, source]))
  const tokensOf = new Map(pack.sources.map(source => [source.n, sourceTokens(source)]))
  const cited = new Set<number>()
  // A run such as "[1][2]" is judged marker by marker, and the markers that hold stay together.
  // Each marker is also compared with the sources outside its own run: when one of those matches the
  // sentence clearly better, the marker moves to it. A Hacker News headline is never moved, because a
  // headline gives too few words to compare with an article extract.
  const cleaned = body.replace(CITATION, (match, run: string, offset: number) => {
    const sentence = sentenceBefore(body, offset)
    const scores = matchScores(sentence, pack.sources, tokensOf)
    const inRun = new Set([...run.matchAll(/\[(\d+)\]/g)].map(([, digits]) => Number(digits)))
    const rivals = pack.sources.filter(source => !inRun.has(source.n))
    const kept: string[] = []
    for (const digits of inRun) {
      const source = bySource.get(digits)
      const own = scores.get(digits) ?? 0
      if (!source) continue
      const rival = source.kind === 'hackernews' ? undefined : rivals.reduce<Source | undefined>(
        (best, candidate) => ((scores.get(candidate.n) ?? 0) > (scores.get(best?.n ?? -1) ?? -1) ? candidate : best),
        undefined,
      )
      const target = rival && clearlyBetter(scores.get(rival.n) ?? 0, own) ? rival.n : digits
      // No connection at all, and nothing better to point to: the marker goes.
      if (target === digits && own === 0) continue
      if (!kept.includes(`[${target}]`)) kept.push(`[${target}]`)
      cited.add(target)
    }
    return kept.length > 0 ? `${match.startsWith(' ') ? ' ' : ''}${kept.join('')}` : ''
  })

  const listed = pack.sources.filter(source => cited.size === 0 || cited.has(source.n))
  const heading = cited.size === 0 ? 'Sources consulted (not cited in the text)' : 'Sources'
  const title = contentType === 'Social Thread' ? `**${heading}**` : `### ${heading}`
  return `${cleaned}\n\n${title}\n\n${listed.map(source => listEntry(source, contentType)).join('\n')}`
}
