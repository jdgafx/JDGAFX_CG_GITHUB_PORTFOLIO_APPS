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
  /** The sentence before this one in the report, as plain words. Read-only context for words such as "These"; it is never judged. */
  context?: string
}

const LIST_BLOCKS = new Set(['paragraph', 'bullet', 'numbered', 'quote'])

/**
 * Every sentence of the report body that carries a [n] marker, in reading order. The ids are
 * positions in that order, so the server and the browser agree on them without exchanging claims.
 */
export function extractClaims(body: string): ClaimDraft[] {
  const claims: ClaimDraft[] = []
  let previous: string | undefined
  parseBlocks(body).forEach((block, b) => {
    if (!LIST_BLOCKS.has(block.kind) || !('text' in block)) return
    sentencePieces(block.text).forEach((piece, p) => {
      const cites = citesOf(piece)
      if (cites.length > 0) {
        claims.push({ id: claims.length + 1, block: b, piece: p, text: piece.trim(), cites, ...(previous ? { context: previous } : {}) })
      }
      const words = readable(piece)
      if (words) previous = words
    })
  })
  return claims
}

const MAX_CONTEXT_CHARS = 400

/** A sentence as it reads aloud: markers and marks removed, and no space left before its punctuation. */
function readable(text: string): string {
  return plainText(text).replace(/\s+([.,;:!?])/g, '$1').slice(0, MAX_CONTEXT_CHARS)
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
 * True when an all-capitals token such as "JWST" is spelled out in the text: a run of consecutive capitalised words whose
 * initial letters are the token ("James Webb Space Telescope"). Lower-case words never count, so "used to see far" does not
 * spell a name. No list of acronyms is involved.
 */
export function spellsOut(token: string, text: string): boolean {
  if (!/^\p{Lu}{2,}$/u.test(token)) return false
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? []
  const initials = words.map(word => (/^\p{Lu}/u.test(word) ? word.charAt(0).toUpperCase() : ''))
  for (let start = 0; start + token.length <= words.length; start += 1) {
    if (token.split('').every((letter, i) => initials[start + i] === letter)) return true
  }
  return false
}

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
    name.split(/[\s-]+/).every(part => {
      if (spellsOut(part, union)) return false
      const lower = part.toLowerCase()
      // The singular counts too: "Suns" is backed by "the Sun".
      return !unionWords.has(stem(lower)) && ![lower, lower.replace(/(?<=\w{2})e?s$/, '')].some(form => union.toLowerCase().includes(form))
    }),
  )
  const level = overlap < FAIL_BELOW ? 'fail' : overlap < WEAK_BELOW || missingNumbers.length > 0 || missingNames.length > 0 ? 'weak' : 'ok'
  return { overlap, best: best?.n ?? null, missingNumbers, missingNames, level }
}

/** A claim the model need not judge: it cites a source that is not in the list. Nothing else is decided by code. */
export function decidedWithoutModel(draft: ClaimDraft, pre: PreCheck): string | null {
  if (pre.best === null) return 'It cites a source that is not in the list.'
  return draft.text ? null : 'Empty sentence.'
}

// ---- Spans ----------------------------------------------------------------------------------------------

interface Folded {
  text: string
  /** For each folded character, its offset in the original. */
  at: number[]
}

/** One space for any run of whitespace and straight quotes for curly ones. Nothing else changes: case, wording and dashes stay. */
function fold(text: string): Folded {
  let out = ''
  const at: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    let ch = text[i] ?? ''
    if (/\s/.test(ch)) ch = ' '
    else if (/[‘’]/.test(ch)) ch = "'"
    else if (/[“”]/.test(ch)) ch = '"'
    if (ch === ' ' && (out === '' || out.endsWith(' '))) continue
    out += ch
    at.push(i)
  }
  return { text: out, at }
}

const MIN_SPAN_CHARS = 15
const MIN_SPAN_WORDS = 3

/**
 * Finds a span the model quoted, character for character, in a source text. Only whitespace and curly quotes are
 * normalised, and an ellipsis the model put at either end is ignored. Returns the span in the original text, or
 * null. A span too short to mean anything is refused. This is the only check code makes on what the model quoted.
 */
export function findSpan(text: string, span: string): { start: number; end: number } | null {
  const bare = span.replace(/(?:…|\.\.\.)+\s*$/, '').replace(/^\s*(?:…|\.\.\.)+/, '')
  const wanted = fold(bare).text.trim()
  if (wanted.length < MIN_SPAN_CHARS || wanted.split(' ').length < MIN_SPAN_WORDS) return null
  const folded = fold(text)
  const found = folded.text.indexOf(wanted)
  if (found === -1) return null
  const start = folded.at[found] ?? 0
  const end = (folded.at[found + wanted.length - 1] ?? start) + 1
  return { start, end }
}

// ---- The verdict ----------------------------------------------------------------------------------------

/** A stretch of source text the model relied on, and the number of the source it took it from. */
export interface JudgedSpan {
  source: number
  text: string
}

/** What the model said about one claim, before the server checks it. */
export interface Judgment {
  id: number
  verdict: 'supported' | 'partly' | 'unsupported'
  spans?: JudgedSpan[]
  /** The part of the claim the source does not cover. Shown, never read by code. */
  uncovered?: string
  /** The model's reason. Shown, never read by code. */
  reason?: string
}

const clean = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 220)

/** Every span that appears verbatim in a source the claim cites, and how many do not. */
function checkSpans(draft: ClaimDraft, sources: Source[], spans: JudgedSpan[]): { quotes: AuditQuote[]; missed: number } {
  const quotes: AuditQuote[] = []
  let missed = 0
  for (const span of spans) {
    const order = [span.source, ...draft.cites].filter(n => draft.cites.includes(n))
    let found: AuditQuote | undefined
    for (const n of new Set(order)) {
      const source = sources.find(candidate => candidate.n === n)
      const at = source ? findSpan(source.snippet, span.text) : null
      if (source && at) {
        found = { n, start: at.start, end: at.end, text: source.snippet.slice(at.start, at.end) }
        break
      }
    }
    if (!found) missed += 1
    else if (!quotes.some(quote => quote.n === found.n && quote.start === found.start && quote.end === found.end)) quotes.push(found)
  }
  return { quotes, missed }
}

/**
 * Turns the model's judgment into the verdict the page shows. The model's typed verdict stands. The one thing code
 * checks is whether the text the model quoted is in a cited source, word for word: a "supported" verdict whose
 * quotes are missing or not found there is "unverified". Code never reads the reason or the claim to change a
 * verdict. No judgment at all is "unchecked", never a guess.
 */
export function settleClaim(draft: ClaimDraft, pre: PreCheck, sources: Source[], judgment: Judgment | undefined): AuditClaim {
  const base = { id: draft.id, block: draft.block, piece: draft.piece, text: draft.text, cites: draft.cites, pre }
  if (!judgment) return { ...base, verdict: 'unchecked', reason: 'The model gave no verdict for this sentence.' }

  const asked = judgment.spans ?? []
  const { quotes, missed } = judgment.verdict === 'unsupported' ? { quotes: [], missed: 0 } : checkSpans(draft, sources, asked)
  let verdict: Verdict = judgment.verdict
  let note = ''
  if (verdict === 'supported' && (quotes.length === 0 || missed > 0)) {
    verdict = 'unverified'
    note = asked.length === 0 ? 'No text was quoted from the source, so support is not confirmed.' : 'The quoted text was not found in the source, so support is not confirmed.'
  }
  const uncovered = verdict === 'partly' || verdict === 'unsupported' ? clean(judgment.uncovered) : ''
  const reason = [clean(judgment.reason), note].filter(Boolean).join(' ')
  return { ...base, verdict, reason: reason || 'No reason given.', ...(quotes.length > 0 && verdict !== 'unverified' ? { quotes } : {}), ...(uncovered ? { uncovered } : {}) }
}

export function summarize(claims: AuditClaim[]): AuditSummary {
  const count = (verdict: Verdict) => claims.filter(claim => claim.verdict === verdict).length
  return {
    total: claims.length,
    supported: count('supported'),
    partly: count('partly'),
    unsupported: count('unsupported'),
    unchecked: count('unchecked'),
    unverified: count('unverified'),
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
    summary.unverified > 0 ? `${summary.unverified} unverified` : '',
    summary.unchecked > 0 ? `${summary.unchecked} not checked` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'Every cited claim is backed by a quote from its source'
}
