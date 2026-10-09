import type { AuditClaim, AuditQuote, AuditSummary, PreCheck, Source, Verdict } from '../types'
import { parseBlocks } from './blocks'
import { SOURCES_HEADING } from './sources'

/** Pure audit logic, imported by the server (which judges) and the browser (which shows the claims at once). */

/** The audit checks at most this many cited sentences; the rest are listed as not checked. */
export const MAX_CLAIMS = 20

/** The report without its Sources section: the part the audit reads. */
export function reportBody(report: string): string {
  const lines = report.split('\n')
  const at = lines.findIndex(line => line.trim() === SOURCES_HEADING)
  return (at === -1 ? lines : lines.slice(0, at)).join('\n').trimEnd()
}

// ---- Sentences and claims -------------------------------------------------------------------------------

const ABBREVIATIONS = new Set(['e.g', 'i.e', 'vs', 'dr', 'mr', 'mrs', 'ms', 'st', 'no', 'approx', 'etc', 'inc', 'u.s', 'fig', 'jr', 'sr'])
const MARKER = /\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/g
/** A sentence ends at . ! or ?, any closing quote and any [n] markers, then a space and a capital, digit or opener. */
const SENTENCE_END = /[.!?]["'”’)]*(?:\s*\[\d{1,3}(?:\s*[,;]\s*\d{1,3})*\])*(\s+)(?=[A-Z0-9"'“(*_`])/g

/** The pieces of a line, cut at sentence ends. Joined, they give back the line exactly. */
export function sentencePieces(text: string): string[] {
  const pieces: string[] = []
  let from = 0
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = (match.index ?? 0) + match[0].length
    const lead = text.slice(0, match.index ?? 0).match(/(\S+)$/)?.[1] ?? ''
    const word = lead.toLowerCase().replace(/^[("'*_`]+/, '')
    if (ABBREVIATIONS.has(word) || /^[A-Z]$/.test(lead.replace(/^[("'*_`]+/, ''))) continue
    pieces.push(text.slice(from, end))
    from = end
  }
  if (from < text.length) pieces.push(text.slice(from))
  return pieces
}

/** Source numbers named by the [n] markers in a sentence, in order, without repeats. */
export function citesOf(text: string): number[] {
  const seen: number[] = []
  for (const match of text.matchAll(MARKER)) {
    for (const part of (match[1] ?? '').split(/\s*[,;]\s*/)) {
      const n = Number(part)
      if (n >= 1 && !seen.includes(n)) seen.push(n)
    }
  }
  return seen
}

/** A sentence as plain words: markers and markdown marks removed. */
export function plainText(text: string): string {
  return text.replace(MARKER, ' ').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
}

export interface ClaimDraft {
  id: number
  block: number
  piece: number
  text: string
  cites: number[]
}

/**
 * A sentence about the research itself ("the research rests on a single source", "no source names the climbers") cites a
 * source but is not a claim of fact the source could state, so the audit does not judge it.
 */
export function isAboutResearch(text: string): boolean {
  return /\b(this|the|these|our) (research|evidence|report|sources?|excerpts?|retrieved)\b|\b(rests?|relies|rely|depends?)\b[^.]{0,30}\b(sources?|corroboration)\b|\bcorroborat\w*|\bone source \[|\b(single|only|one) source\b/i.test(plainText(text))
}

const LIST_BLOCKS = new Set(['paragraph', 'bullet', 'numbered', 'quote'])

/**
 * Every sentence of the report body that carries a [n] marker, in reading order. The ids are
 * positions in that order, so the server and the browser agree on them without exchanging claims.
 */
export function extractClaims(body: string): ClaimDraft[] {
  const claims: ClaimDraft[] = []
  parseBlocks(body).forEach((block, b) => {
    if (!LIST_BLOCKS.has(block.kind) || !('text' in block)) return
    sentencePieces(block.text).forEach((piece, p) => {
      const cites = citesOf(piece)
      if (cites.length === 0 || isAboutResearch(piece)) return
      claims.push({ id: claims.length + 1, block: b, piece: p, text: piece.trim(), cites })
    })
  })
  return claims
}

// ---- The pre-pass ---------------------------------------------------------------------------------------

const STOP_WORDS = new Set(
  (
    'a about above after again all also am an and any are as at be because been before being below between both but by can ' +
    'could did do does doing down during each few for from further had has have having he her here hers him his how i if in ' +
    'into is it its just me more most my no nor not of off on once only or other our out over own same she should so some ' +
    'such than that the their them then there these they this those through to too under until up very was we were what ' +
    'when where which while who whom why will with would you your'
  ).split(' '),
)

/** Months and weekdays are capitalised but are not names a source must spell the same way ("Dec 2022" backs "December 2022"). */
const CALENDAR_WORDS = new Set(
  'january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday'.split(' '),
)

/** Folds plural s, -ing and -ed, so "launched" meets "launching". */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/** Lower-case content words: three or more characters, no stop words, endings folded. */
export function contentWords(text: string): Set<string> {
  const words = new Set<string>()
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (raw.length < 3 || STOP_WORDS.has(raw)) continue
    words.add(stem(raw))
  }
  return words
}

/** One number as a comparable value: no thousands commas, no leading zeros, no trailing decimal zeros ("05" is "5", "6.50" is "6.5"). */
function normalNumber(raw: string): string {
  const [whole = '', fraction] = raw.replace(/,/g, '').replace(/\.$/, '').split('.')
  const int = whole.replace(/^0+(?=\d)/, '')
  const frac = fraction?.replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

/**
 * The numbers in a text as comparable values. A time such as 05:12 or 5:12:30 is one value, so "5:12" and "05:12" are
 * the same; other numbers drop thousands commas, leading zeros and trailing decimal zeros.
 */
export function numbersIn(text: string): string[] {
  const found: string[] = []
  const rest = text.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, time => {
    found.push(time.split(':').map(part => String(Number(part))).join(':'))
    return ' '
  })
  for (const value of rest.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) found.push(normalNumber(value))
  return [...new Set(found)]
}

/** Capitalised names in a sentence: runs of capitalised words, and acronyms. A lone capital at the start is not a name. */
export function namesIn(text: string): string[] {
  const names: string[] = []
  let run: string[] = []
  let runStart = 0
  const flush = () => {
    const lone = run.length === 1 && runStart === 0 && !/[A-Z]{2}|\d/.test(run[0] ?? '')
    if (run.length > 0 && !lone) names.push(run.join(' '))
    run = []
  }
  text
    .split(/\s+/)
    .filter(Boolean)
    .forEach((token, i) => {
      const word = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['\u2019]s$/, '')
      if (/^\p{Lu}/u.test(word) && !STOP_WORDS.has(word.toLowerCase()) && !CALENDAR_WORDS.has(word.toLowerCase())) {
        if (/^[("[]/.test(token)) flush()
        if (run.length === 0) runStart = i
        run.push(word)
        if (/[,;:.)\]"]$/.test(token)) flush()
      } else flush()
    })
  flush()
  return [...new Set(names)]
}

/** The text of a source as the audit reads it: the title, the extract and the counts line. */
export function sourceText(source: Source): string {
  return [source.title, source.snippet, source.note ?? ''].join(' ')
}

/** Overlap below this shares too little with the cited text to be a paraphrase of it. */
const FAIL_BELOW = 0.25
const WEAK_BELOW = 0.5

/**
 * The deterministic check of one sentence against the sources it cites: how many of its content words the
 * cited text contains, whether every number in it appears there, and whether every name does.
 */
export function preCheck(claim: string, cites: number[], sources: Source[]): PreCheck {
  const cited = cites.map(n => sources.find(source => source.n === n)).filter((source): source is Source => source !== undefined)
  if (cited.length === 0) return { overlap: 0, best: null, missingNumbers: [], missingNames: [], level: 'fail' }

  const plain = plainText(claim)
  const wanted = contentWords(plain)
  const union = cited.map(sourceText).join(' ')
  const unionWords = contentWords(union)
  const overlapWith = (words: Set<string>) => {
    if (wanted.size === 0) return 0
    let shared = 0
    for (const word of wanted) if (words.has(word)) shared += 1
    return shared / wanted.size
  }

  let best = cited[0]
  let bestScore = -1
  for (const source of cited) {
    const score = overlapWith(contentWords(sourceText(source)))
    if (score > bestScore) {
      best = source
      bestScore = score
    }
  }

  const overlap = overlapWith(unionWords)
  const haveNumbers = new Set(numbersIn(union))
  const missingNumbers = numbersIn(plain).filter(value => !haveNumbers.has(value))
  // A name is missing only when none of its words is in the cited text, so "Ukrainian SSR" is backed by "Ukrainian Soviet Socialist Republic".
  const missingNames = namesIn(plain).filter(name =>
    name.split(' ').every(part => !unionWords.has(stem(part.toLowerCase())) && !union.toLowerCase().includes(part.toLowerCase())),
  )
  const level = overlap < FAIL_BELOW ? 'fail' : overlap < WEAK_BELOW || missingNumbers.length > 0 || missingNames.length > 0 ? 'weak' : 'ok'
  return { overlap, best: best?.n ?? null, missingNumbers, missingNames, level }
}

/** A claim the model need not judge: it cites nothing that exists, or shares no content word with what it cites. */
export function decidedWithoutModel(draft: ClaimDraft, pre: PreCheck): string | null {
  if (pre.best === null) return 'It cites a source that is not in the list.'
  if (pre.overlap === 0) return 'It shares no content word with the source it cites.'
  return draft.text ? null : 'Empty sentence.'
}

// ---- Quotes ---------------------------------------------------------------------------------------------

interface Folded {
  text: string
  /** For each folded character, its offset in the original. */
  at: number[]
}

/** Lower case, one space for any whitespace, straight quotes and hyphens, so a copied quote still matches. */
function fold(text: string): Folded {
  let out = ''
  const at: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    let ch = (text[i] ?? '').toLowerCase()
    if (/\s/.test(ch)) ch = ' '
    else if (/[‘’]/.test(ch)) ch = "'"
    else if (/[“”]/.test(ch)) ch = '"'
    else if (/[‐-―−]/.test(ch)) ch = '-'
    if (ch === ' ' && (out === '' || out.endsWith(' '))) continue
    out += ch
    at.push(i)
  }
  return { text: out, at }
}

const MIN_QUOTE_CHARS = 15
const MIN_QUOTE_WORDS = 3

/**
 * Finds a quote word for word in a source text, ignoring case, spacing, curly quotes and a trailing ellipsis.
 * Returns the span in the original text, or null. A quote that is too short to mean anything is refused.
 */
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const wanted = fold(quote.replace(/(?:…|\.\.\.)+\s*$/, '').replace(/^(?:…|\.\.\.)+\s*/, '')).text.trim()
  if (wanted.length < MIN_QUOTE_CHARS || wanted.split(' ').length < MIN_QUOTE_WORDS) return null
  const folded = fold(text)
  const found = folded.text.indexOf(wanted)
  if (found === -1) return null
  const start = folded.at[found] ?? 0
  const end = (folded.at[found + wanted.length - 1] ?? start) + 1
  return { start, end }
}

// ---- The verdict ----------------------------------------------------------------------------------------

/** What the model said about one claim, before the server checks it. */
export interface Judgment {
  id: number
  verdict: 'supported' | 'partly' | 'unsupported'
  source?: number
  quote?: string
  reason?: string
}

const cleanReason = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 220)

function listOf(items: string[]): string {
  return items.join(', ')
}

/**
 * Turns the model's judgment into the verdict the page shows, after the checks the model cannot waive:
 * a quote must be word for word in a cited source; "supported" needs such a quote; a number in the
 * claim that no cited source contains caps it at "partly supported"; a name that none contains also does.
 * No judgment at all is "unchecked", never a guess.
 */
export function settleClaim(draft: ClaimDraft, pre: PreCheck, sources: Source[], judgment: Judgment | undefined): AuditClaim {
  const base = { id: draft.id, block: draft.block, piece: draft.piece, text: draft.text, cites: draft.cites, pre }
  if (!judgment) return { ...base, verdict: 'unchecked', reason: 'The model gave no verdict for this sentence.' }

  let quote: AuditQuote | undefined
  if (judgment.quote && judgment.verdict !== 'unsupported') {
    const order = [judgment.source, ...draft.cites].filter((n): n is number => n !== undefined && draft.cites.includes(n))
    for (const n of new Set(order)) {
      const source = sources.find(candidate => candidate.n === n)
      const span = source ? findQuote(source.snippet, judgment.quote) : null
      if (source && span) {
        quote = { n, start: span.start, end: span.end, text: source.snippet.slice(span.start, span.end) }
        break
      }
    }
  }

  let verdict: Verdict = judgment.verdict
  const notes: string[] = []
  if (verdict === 'supported' && !quote) {
    verdict = 'partly'
    notes.push(judgment.quote ? 'The quoted sentence is not in the source text, so support is not confirmed.' : 'No supporting sentence was quoted.')
  }
  if (verdict === 'supported' && pre.missingNumbers.length > 0) {
    verdict = 'partly'
    notes.push(`The source text does not contain ${listOf(pre.missingNumbers)}.`)
  }
  if (verdict === 'supported' && pre.missingNames.length > 0) {
    verdict = 'partly'
    notes.push(`The source text does not mention ${listOf(pre.missingNames)}.`)
  }
  const reason = [cleanReason(judgment.reason), ...notes].filter(Boolean).join(' ')
  return { ...base, verdict, reason: reason || 'No reason given.', ...(quote ? { quote } : {}) }
}

export function summarize(claims: AuditClaim[]): AuditSummary {
  const count = (verdict: Verdict) => claims.filter(claim => claim.verdict === verdict).length
  return {
    total: claims.length,
    supported: count('supported'),
    partly: count('partly'),
    unsupported: count('unsupported'),
    unchecked: count('unchecked'),
  }
}

/** "14 of 16 cited claims supported", with the rest named when there are any. */
export function summaryLine(summary: AuditSummary): string {
  if (summary.total === 0) return 'No cited claims to check'
  const noun = summary.total === 1 ? 'cited claim' : 'cited claims'
  return `${summary.supported} of ${summary.total} ${noun} supported`
}

/** The parts of the summary beyond "supported", for the line under the bar. */
export function summaryDetail(summary: AuditSummary): string {
  const parts = [
    summary.partly > 0 ? `${summary.partly} partly supported` : '',
    summary.unsupported > 0 ? `${summary.unsupported} not supported` : '',
    summary.unchecked > 0 ? `${summary.unchecked} not checked` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'Every cited claim is backed by a quote from its source'
}
