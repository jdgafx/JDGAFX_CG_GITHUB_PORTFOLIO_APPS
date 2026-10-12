import type { AuditClaim, AuditJudged, AuditQuote, AuditSummary, PreCheck, Source, Verdict } from '../types'
import { parseBlocks, type Block } from './blocks'
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
  /** Which text unit of the block holds the sentence (see AuditClaim.unit). */
  unit?: number
  text: string
  cites: number[]
  /** The sentence before this one in its own text unit in the report, as plain words. Read-only context for words such as "These"; it is never judged. */
  context?: string
}

/**
 * The pieces of text a block holds, each read as running prose: one for a paragraph, list item, quote or heading,
 * a cell each for a table (header first, then row by row), a line each for code. A rule or blank line holds none.
 */
export function textUnits(block: Block): string[] {
  switch (block.kind) {
    case 'table':
      return [...block.header, ...block.rows.flat()]
    case 'code':
      return block.lines
    case 'paragraph':
    case 'bullet':
    case 'numbered':
    case 'quote':
    case 'heading':
      return [block.text]
    default:
      return []
  }
}

/**
 * Every sentence of the report body that carries a [n] marker, wherever it sits (paragraph, list, quote, heading,
 * table cell or code line), in reading order. The ids are positions in that order, so the server and the browser agree
 * on them without exchanging claims. The context of a sentence is the one before it in the same text unit.
 */
export function extractClaims(body: string): ClaimDraft[] {
  const claims: ClaimDraft[] = []
  parseBlocks(body).forEach((block, b) => {
    textUnits(block).forEach((unitText, unit) => {
      let previous: string | undefined
      sentencePieces(unitText).forEach((piece, p) => {
        if (citesOf(piece).length > 0) {
          claims.push({ id: claims.length + 1, block: b, unit, piece: p, text: piece.trim(), cites: citesOf(piece), ...(previous ? { context: previous } : {}) })
        }
        const words = readable(piece)
        if (words) previous = words
      })
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

/** Lower case, one space for any whitespace, straight quotes and one hyphen for any dash, so a copied span still matches. Wording is untouched. */
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

const MIN_SPAN_WORDS = 3
const ELLIPSIS = /\s*(?:…|\.\.\.)\s*/

/**
 * Finds a span the model quoted in a source text: the same words, ignoring case, spacing, quote marks and dash
 * variants. An ellipsis at either end is dropped. An ellipsis inside the span splits it into passages, and every
 * passage must be found, so the result has one range per passage (in the original text), or null. Each passage
 * needs three words at least, so a stray word cannot verify anything. This is the only check code makes on what
 * the model quoted.
 */
export function findSpan(text: string, span: string): Array<{ start: number; end: number }> | null {
  const bare = span.replace(/(?:…|\.\.\.)+\s*$/, '').replace(/^\s*(?:…|\.\.\.)+/, '')
  const parts = bare
    .split(ELLIPSIS)
    .map(part => fold(part).text.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  const folded = fold(text)
  const ranges: Array<{ start: number; end: number }> = []
  for (const wanted of parts) {
    if (wanted.split(' ').length < MIN_SPAN_WORDS) return null
    const found = folded.text.indexOf(wanted)
    if (found === -1) return null
    const start = folded.at[found] ?? 0
    ranges.push({ start, end: (folded.at[found + wanted.length - 1] ?? start) + 1 })
  }
  return ranges
}

// ---- The verdict ----------------------------------------------------------------------------------------

/** A stretch of source text the model relied on, and the number of the source it took it from. */
export interface JudgedSpan {
  source: number
  text: string
}

/**
 * What the model said about one claim: four typed answers and the passages it relied on. It never sends a verdict;
 * the verdict is derived from the answers and the span check (deriveVerdict).
 */
export interface Judgment {
  id: number
  /** 'about_research' when the sentence is about the research or the sources themselves, not a statement a source could back. The model types it; code never reads the sentence. Default: source_claim. */
  kind?: 'source_claim' | 'about_research'
  /** 'no' when the cited sources do not state the claim, or state something incompatible with it. */
  sourceSupports: 'yes' | 'no'
  /** 'yes' only when the source says it about the same subject the claim names, once referents are resolved. */
  subjectMatches: 'yes' | 'no'
  /** 'not_applicable' when the claim gives no cause, reason, purpose or order. */
  causeMatches: 'yes' | 'no' | 'not_applicable'
  allPartsCovered: 'yes' | 'no'
  spans?: JudgedSpan[]
  /** How many entries of the spans list were malformed. Each counts as a span that was not found. */
  badSpans?: number
  /** The part of the claim the source does not cover. Shown, never read by code. */
  uncovered?: string
  /** The model's reason. Shown, never read by code. */
  reason?: string
}

/** What the span check found: spans found as one passage, spans not found (or malformed), and spans found only as two or more passages. */
export interface SpanCheck {
  found: number
  missed: number
  joined: number
}

/**
 * The verdict, from the typed answers and the span check, and nothing else.
 * No support is "unsupported". Every answer passing and every span one found passage is "supported"; every answer
 * passing but the spans missing, not found or joined is "unverified". Any answer failing is "partly".
 */
export function deriveVerdict(
  answers: Pick<Judgment, 'sourceSupports' | 'subjectMatches' | 'causeMatches' | 'allPartsCovered'>,
  spans: SpanCheck,
): Verdict {
  if (answers.sourceSupports === 'no') return 'unsupported'
  const passes = answers.subjectMatches === 'yes' && answers.causeMatches !== 'no' && answers.allPartsCovered === 'yes'
  if (!passes) return 'partly'
  return spans.found > 0 && spans.missed === 0 && spans.joined === 0 ? 'supported' : 'unverified'
}

const clean = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 220)

/** Every passage of every span that appears in a source the claim cites, and the tally of what was found. */
function checkSpans(draft: ClaimDraft, sources: Source[], spans: JudgedSpan[], bad: number): { quotes: AuditQuote[]; check: SpanCheck } {
  const quotes: AuditQuote[] = []
  const check: SpanCheck = { found: 0, missed: bad, joined: 0 }
  for (const span of spans) {
    const order = [span.source, ...draft.cites].filter(n => draft.cites.includes(n))
    let found: AuditQuote[] | undefined
    for (const n of new Set(order)) {
      const source = sources.find(candidate => candidate.n === n)
      const at = source ? findSpan(source.snippet, span.text) : null
      if (source && at) {
        found = at.map(range => ({ n, start: range.start, end: range.end, text: source.snippet.slice(range.start, range.end) }))
        break
      }
    }
    if (!found) check.missed += 1
    else {
      check.found += 1
      if (found.length > 1) check.joined += 1
      for (const quote of found) if (!quotes.some(have => have.n === quote.n && have.start === quote.start && have.end === quote.end)) quotes.push(quote)
    }
  }
  return { quotes, check }
}

/**
 * Turns the model's typed answers into the verdict the page shows: deriveVerdict on the answers and the span check.
 * Code never reads the reason, the uncovered text or the claim to change a verdict. No judgment at all is
 * "unchecked", never a guess.
 */
export function settleClaim(draft: ClaimDraft, pre: PreCheck, sources: Source[], judgment: Judgment | undefined): AuditClaim {
  const base = { id: draft.id, block: draft.block, piece: draft.piece, ...(draft.unit ? { unit: draft.unit } : {}), text: draft.text, cites: draft.cites, pre }
  if (!judgment) return { ...base, verdict: 'unchecked', reason: 'The model gave no verdict for this sentence.' }

  const asked = judgment.spans ?? []
  const kind = judgment.kind ?? 'source_claim'
  if (kind === 'about_research') {
    return { ...base, verdict: 'research', reason: clean(judgment.reason) || 'About the research, not a statement a source could back.', judged: { kind, spans: { asked, found: 0, missed: 0, joined: 0, malformed: 0 } } }
  }
  const { quotes, check } = judgment.sourceSupports === 'no' ? { quotes: [], check: { found: 0, missed: 0, joined: 0 } } : checkSpans(draft, sources, asked, judgment.badSpans ?? 0)
  const verdict = deriveVerdict(judgment, check)
  let note = ''
  if (verdict === 'unverified') {
    note =
      asked.length === 0 && check.missed === 0
        ? 'No text was quoted from the source, so support is not confirmed.'
        : check.missed === 0
          ? 'A quoted span joins separate passages of the source, so support is not confirmed.'
          : 'The quoted text was not found in the source, so support is not confirmed.'
  }
  const uncovered = verdict === 'partly' || verdict === 'unsupported' ? clean(judgment.uncovered) : ''
  const reason = [clean(judgment.reason), note].filter(Boolean).join(' ')
  const judged: AuditJudged = {
    kind,
    answers: { sourceSupports: judgment.sourceSupports, subjectMatches: judgment.subjectMatches, causeMatches: judgment.causeMatches, allPartsCovered: judgment.allPartsCovered },
    spans: { asked, found: check.found, missed: check.missed, joined: check.joined, malformed: judgment.badSpans ?? 0 },
  }
  return { ...base, judged, verdict, reason: reason || 'No reason given.', ...(quotes.length > 0 && (verdict === 'supported' || verdict === 'partly') ? { quotes } : {}), ...(uncovered ? { uncovered } : {}) }
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
    research: count('research'),
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
    summary.research > 0 ? `${summary.research} about the research` : '',
    summary.unchecked > 0 ? `${summary.unchecked} not checked` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'Every cited claim is backed by a quote from its source'
}
