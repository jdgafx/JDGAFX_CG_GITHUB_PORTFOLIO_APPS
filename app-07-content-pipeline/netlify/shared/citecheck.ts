// The citation check, ported from app-01's audit: the model answers typed questions about each cited
// sentence and quotes the passages it relied on; code checks every quote is in the source word for word and
// derives the verdict. The model never gives the verdict. Pure and shared with the browser, which places the
// marks with the same sentence split the server used to number the claims.
import { parseBlocks, type Block } from '../../src/lib/blocks'

/** One request checks at most this many cited sentences; the rest are listed as not checked. */
export const MAX_CLAIMS = 12
/** Claims per model call. Three claims with thinking on fit a call's token ceiling and its time limit (see citerun.ts). */
export const BATCH_CLAIMS = 3

/** The whole request is stopped here, body read included, under the 26 s the platform allows a function. */
export const CHECK_REQUEST_LIMIT_MS = 26_000
/** The browser waits for the server's worst case plus 3 s, so it never waits past the 30 s platform cut (C14). */
export const CHECK_WATCHDOG_MS = CHECK_REQUEST_LIMIT_MS + 3_000

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
function plainText(text: string): string {
  return text.replace(MARKER, ' ').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
}

export interface ClaimDraft {
  id: number
  text: string
  cites: number[]
  /** The sentence before this one in its own text unit, as plain words. Read-only context for words such as "These"; it is never judged. */
  context?: string
}

/** The pieces of text a block holds, each read as running prose: a paragraph or heading is one, a list has one per item. */
export function textUnits(block: Block): string[] {
  switch (block.kind) {
    case 'paragraph':
    case 'heading':
      return [block.text]
    case 'list':
      return block.items
    default:
      return []
  }
}

const MAX_CONTEXT_CHARS = 400

/** A sentence as it reads aloud: markers and marks removed, and no space left before its punctuation. */
function readable(text: string): string {
  return plainText(text).replace(/\s+([.,;:!?])/g, '$1').slice(0, MAX_CONTEXT_CHARS)
}

/**
 * Every sentence of the piece body that carries a [n] marker, in reading order. The ids are positions in that
 * order, so the server and the browser agree on them without exchanging claims. The body must be the piece
 * without its Sources list (bodyOf), whose lines carry markers of their own.
 */
export function extractClaims(body: string): ClaimDraft[] {
  const claims: ClaimDraft[] = []
  for (const block of parseBlocks(body)) {
    for (const unitText of textUnits(block)) {
      let previous: string | undefined
      for (const piece of sentencePieces(unitText)) {
        if (citesOf(piece).length > 0) {
          claims.push({ id: claims.length + 1, text: piece.trim(), cites: citesOf(piece), ...(previous ? { context: previous } : {}) })
        }
        const words = readable(piece)
        if (words) previous = words
      }
    }
  }
  return claims
}

// ---- Spans ----------------------------------------------------------------------------------------------

/** Lower case, one space for any whitespace, straight quotes and one hyphen for any dash, so a copied span still matches. Wording is untouched. */
function fold(text: string): string {
  let out = ''
  for (const raw of text) {
    let ch = raw.toLowerCase()
    if (/\s/.test(ch)) ch = ' '
    else if (/[‘’]/.test(ch)) ch = "'"
    else if (/[“”]/.test(ch)) ch = '"'
    else if (/[‐-―−]/.test(ch)) ch = '-'
    if (ch === ' ' && (out === '' || out.endsWith(' '))) continue
    out += ch
  }
  return out
}

/** A passage needs two words to count at all, and a claim needs a span of three words or more to be confirmed. */
const MIN_SPAN_WORDS = 2
export const STRONG_SPAN_WORDS = 3
const ELLIPSIS = /\s*(?:…|\.\.\.)\s*/

/** Where a quoted span is in a source text: 'too_short' means it is there word for word but has fewer than two words in a passage. */
export type SpanLocation = { status: 'found'; passages: number; words: number } | { status: 'too_short' } | { status: 'not_found' }

/**
 * Looks for a span the model quoted in a source text: the same words, ignoring case, spacing, quote marks and dash
 * variants. An ellipsis at either end is dropped; one inside the span splits it into passages, and every passage must
 * be found. This is the only check code makes on what the model quoted.
 */
export function locateSpan(text: string, span: string): SpanLocation {
  const bare = span.replace(/(?:…|\.\.\.)+\s*$/, '').replace(/^\s*(?:…|\.\.\.)+/, '')
  const parts = bare
    .split(ELLIPSIS)
    .map(part => fold(part).trim())
    .filter(Boolean)
  if (parts.length === 0) return { status: 'not_found' }
  const folded = fold(text)
  let short = false
  let words = 0
  for (const wanted of parts) {
    if (!folded.includes(wanted)) return { status: 'not_found' }
    const count = wanted.split(' ').length
    if (count < MIN_SPAN_WORDS) short = true
    words += count
  }
  return short ? { status: 'too_short' } : { status: 'found', passages: parts.length, words }
}

// ---- The verdict ----------------------------------------------------------------------------------------

export type Verdict = 'supported' | 'partly' | 'unsupported' | 'unverified' | 'unchecked'

/** A stretch of source text the model relied on, and the number of the source it took it from. */
export interface JudgedSpan {
  source: number
  text: string
}

/** What the model said about one claim: four typed answers and the passages it relied on. It never sends a verdict. */
export interface Judgment {
  id: number
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

/** What the span check found: spans found, spans not found (or malformed), spans joined from separate passages, and found spans of three words or more. */
export interface SpanCheck {
  found: number
  missed: number
  joined: number
  strong: number
}

/**
 * The verdict, from the typed answers and the span check, and nothing else. No support is "unsupported". Every
 * answer passing, every span found as one passage and one found span of three words or more is "supported"; every
 * answer passing but the spans missing, not found, joined or all too short is "unverified". Any answer failing is "partly".
 */
export function deriveVerdict(
  answers: Pick<Judgment, 'sourceSupports' | 'subjectMatches' | 'causeMatches' | 'allPartsCovered'>,
  spans: SpanCheck,
): Verdict {
  if (answers.sourceSupports === 'no') return 'unsupported'
  const passes = answers.subjectMatches === 'yes' && answers.causeMatches !== 'no' && answers.allPartsCovered === 'yes'
  if (!passes) return 'partly'
  return spans.strong > 0 && spans.missed === 0 && spans.joined === 0 ? 'supported' : 'unverified'
}

/** The text of a source as the check reads it: the extract the Sources step held, which is all a span may come from. */
export interface CheckSource {
  n: number
  title: string
  summary: string
}

function checkSpans(draft: ClaimDraft, sources: CheckSource[], spans: JudgedSpan[], bad: number): SpanCheck {
  const check: SpanCheck = { found: 0, missed: bad, joined: 0, strong: 0 }
  for (const span of spans) {
    // The source the model named is tried first, then the other sources the claim cites.
    const order = new Set([span.source, ...draft.cites].filter(n => draft.cites.includes(n)))
    let found: Extract<SpanLocation, { status: 'found' }> | undefined
    let tooShort = false
    for (const n of order) {
      const source = sources.find(candidate => candidate.n === n)
      const at = source ? locateSpan(source.summary, span.text) : ({ status: 'not_found' } as const)
      if (at.status === 'found') {
        found = at
        break
      }
      if (at.status === 'too_short') tooShort = true
    }
    if (found) {
      check.found += 1
      if (found.words >= STRONG_SPAN_WORDS) check.strong += 1
      if (found.passages > 1) check.joined += 1
    } else if (!tooShort) check.missed += 1
  }
  return check
}

export interface CheckedClaim {
  id: number
  /** The sentence as the server read it. The browser uses a verdict only for a sentence whose text it shares. */
  text: string
  verdict: Verdict
  /** Shown, never read by code. */
  reason: string
  uncovered?: string
}

const clean = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 220)

/** A claim the model did not judge, or that was never sent: it is not checked. */
export function uncheckedClaim(draft: ClaimDraft, reason: string): CheckedClaim {
  return { id: draft.id, text: draft.text, verdict: 'unchecked', reason }
}

/** A claim the model need not judge: it cites no source in the list. Nothing else is decided by code before the model. */
export function decidedWithoutModel(draft: ClaimDraft, sources: CheckSource[]): CheckedClaim | null {
  if (!draft.cites.some(n => sources.some(source => source.n === n))) {
    return { id: draft.id, text: draft.text, verdict: 'unsupported', reason: 'It cites a source that is not in the list.' }
  }
  return null
}

/**
 * Turns the model's typed answers into the verdict: deriveVerdict on the answers and the span check. Code never
 * reads the reason, the uncovered text or the claim to change a verdict. No judgment at all is "unchecked".
 */
export function settleClaim(draft: ClaimDraft, sources: CheckSource[], judgment: Judgment | undefined): CheckedClaim {
  if (!judgment) return uncheckedClaim(draft, 'The model gave no answer for this sentence.')
  const check = judgment.sourceSupports === 'no' ? { found: 0, missed: 0, joined: 0, strong: 0 } : checkSpans(draft, sources, judgment.spans ?? [], judgment.badSpans ?? 0)
  const verdict = deriveVerdict(judgment, check)
  let note = ''
  if (verdict === 'unverified') {
    note =
      (judgment.spans ?? []).length === 0 && check.missed === 0
        ? 'No text was quoted from the source.'
        : check.missed > 0
          ? 'The quoted text was not found in the source.'
          : check.joined > 0
            ? 'A quoted span joins separate passages of the source.'
            : 'The quoted passages are too short to confirm it.'
  }
  const uncovered = verdict === 'partly' || verdict === 'unsupported' ? clean(judgment.uncovered) : ''
  const reason = [clean(judgment.reason), note].filter(Boolean).join(' ')
  return { id: draft.id, text: draft.text, verdict, reason: reason || 'No reason given.', ...(uncovered ? { uncovered } : {}) }
}

// ---- What the page shows --------------------------------------------------------------------------------

/** The four things the page says about a cited sentence. Only a "supported" verdict is ever shown as confirmed. */
export type CiteView = 'confirmed' | 'not_confirmed' | 'not_checked' | 'checking'

export const CITE_VIEW_WORD: Record<CiteView, string> = {
  confirmed: 'Confirmed',
  not_confirmed: 'Not confirmed',
  not_checked: 'Not checked',
  checking: 'Checking',
}

export function viewOf(verdict: Verdict): CiteView {
  switch (verdict) {
    case 'supported':
      return 'confirmed'
    case 'unchecked':
      return 'not_checked'
    case 'partly':
    case 'unsupported':
    case 'unverified':
      return 'not_confirmed'
  }
}

export interface CheckSummary {
  total: number
  confirmed: number
  notConfirmed: number
  notChecked: number
}

export function summarizeViews(views: CiteView[]): CheckSummary {
  const count = (view: CiteView) => views.filter(candidate => candidate === view).length
  return { total: views.length, confirmed: count('confirmed'), notConfirmed: count('not_confirmed'), notChecked: count('not_checked') + count('checking') }
}
