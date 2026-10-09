import type { Decider, ReviewComment, Verdict } from '../../src/types'
import { codeNames, collapse, MIN_QUOTE_CHARS, QUOTE_WINDOW, type Doc } from './anchor'
import { parseJsonObject, type Candidate, type CheckedDrop } from './review'

/** A moved comment may travel at most this far from where the checks left it. Further is not a correction. */
export const MAX_MOVE = 25
/** The quoted code may sit this many lines from the line the verifier names (a statement can span lines). */
const KEEP_WINDOW = 1
const MAX_REASON_CHARS = 300
const MAX_EVIDENCE_CHARS = 160

export function buildVerifyPrompt(kind: 'file' | 'pr', lineCount: number): string {
  const what = kind === 'pr' ? 'a pull request diff' : 'a source file'
  const placing =
    kind === 'pr'
      ? 'A comment may only sit on a line that starts with + or -. Never move a comment to context, a file line or a hunk line.'
      : 'A comment may sit on any line that holds code.'
  return `You are a sceptical senior engineer. Another reviewer wrote comments on ${what}. Check every comment against the code itself. You return JSON and nothing else.

The code is shown with a line number, a tab and a pipe in front of every line. That prefix is scaffolding, not code.
${placing}

For each comment, find the code it is about, read that code, and decide:
- "keep": the claim is true of this code and the suggestion is a concrete change. Keep a true, concrete finding even when it is minor.
- "move": the claim is true, but the code it is about is on a different line than the comment sits on. Give the line of that code: the statement the message talks about (the call, the assignment, the condition), never the signature of the function that contains it. Use the "nearby" lines given with each comment to find it.
- "drop": only when one of these holds. (1) The claim is false: the code shows the opposite. (2) The claim rests on code that is not in this ${kind === 'pr' ? 'diff' : 'file'} and so cannot be checked here. (3) The code already does what the suggestion asks. (4) The suggestion changes nothing ("leave as-is", "keep it"). (5) It objects to something the code must do: a parameter that an interface or callback signature requires (an http.HandlerFunc takes a request argument), a deprecated member kept for compatibility, or a form the language demands. (6) Its own message calls the code safe or harmless while rating it warning or critical.
Test the claim, do not trust it. If it says a value is unused, look for its uses. If it says code is called somewhere, find the call. If it names a package, helper or behaviour, check that the ${kind === 'pr' ? 'diff' : 'file'} shows it. If it is true and concrete, keep it; do not drop a comment for being minor or a matter of taste.

Respond with valid JSON in exactly this shape, with no markdown fence and no prose:
{
  "verdicts": [
    {
      "id": <the comment's id>,
      "verdict": "keep" | "move" | "drop",
      "line": <integer 1 to ${lineCount}: for keep the comment's line, for move the line the comment is really about, for drop the line of the code that shows why>,
      "evidence": "<code copied verbatim from that line, at most 100 characters, without the line number prefix>",
      "reason": "<one sentence of at most 30 words that quotes the code and says why you decided this>"
    }
  ]
}

Give exactly one verdict per comment id, in the same order. The evidence must really appear on the line you give. Never invent code.`
}

/** The second pass sees the same numbered code plus the first pass's comments, each with its id. */
export function buildVerifyUser(numbered: string, candidates: Candidate[], shown: string[]): string {
  const nearby = (line: number) =>
    shown
      .slice(Math.max(0, line - 7), line + 6)
      .map((text, i) => `${Math.max(0, line - 7) + i + 1}\t| ${text}`)
      .join('\n')
  const comments = candidates.map((c) => ({
    id: c.id,
    line: c.line,
    quote: c.quote,
    nearby: nearby(c.line),
    // When an automatic check moved the comment, the second pass sees both places and decides which one is right.
    ...(c.fromLine !== c.line
      ? { firstPassLine: c.fromLine, firstPassNearby: nearby(c.fromLine), note: `The first pass cited line ${c.fromLine}; an automatic check moved the comment to line ${c.line}. Answer with the line the comment is really about, which may be either.` }
      : {}),
    severity: c.severity,
    message: c.message,
    suggestion: c.suggestion,
  }))
  return `Code:\n\n${numbered}\n\nComments to check:\n\n${JSON.stringify(comments, null, 1)}`
}

export interface RawVerdict {
  id: number
  verdict: string
  line: number | null
  evidence: string
  reason: string
}

/** The verdict list from a reply: an object with a verdicts array, or the bare array the model sometimes returns. */
function verdictList(text: string): unknown[] | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const value: unknown = JSON.parse(cleaned)
    if (Array.isArray(value)) return value
  } catch {
    // Not a bare array: fall through to an object with a verdicts array, possibly inside prose.
  }
  const object = parseJsonObject(cleaned)
  return object && Array.isArray(object.verdicts) ? object.verdicts : null
}

/** Reads the verdicts in a reply. Returns null when the reply holds no list of verdicts at all. */
export function readVerdicts(text: string): Map<number, RawVerdict> | null {
  const list = verdictList(text)
  if (!list) return null
  const byId = new Map<number, RawVerdict>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const v = item as Record<string, unknown>
    if (typeof v.id !== 'number' || !Number.isInteger(v.id) || byId.has(v.id)) continue
    byId.set(v.id, {
      id: v.id,
      verdict: typeof v.verdict === 'string' ? v.verdict.trim().toLowerCase() : '',
      line: typeof v.line === 'number' && Number.isInteger(v.line) ? v.line : null,
      evidence: typeof v.evidence === 'string' ? v.evidence.slice(0, MAX_EVIDENCE_CHARS * 2) : '',
      reason: typeof v.reason === 'string' ? collapse(v.reason).slice(0, MAX_REASON_CHARS) : '',
    })
  }
  return byId
}

/** The forms a quoted fragment may take: as written, without a copied line-number prefix, without a diff + or -. */
function evidenceForms(evidence: string): string[] {
  const bare = evidence.trim().replace(/^(['"`])(.*)\1$/s, '$2')
  const noNumber = bare.replace(/^\d+\s*\|\s?/, '')
  const noSign = noNumber.replace(/^[+-]\s?/, '')
  return [...new Set([bare, noNumber, noSign].map(collapse))].filter((f) => f.length >= MIN_QUOTE_CHARS)
}

/** The line within `window` of `near` (nearest first, later on a tie) whose code holds the evidence, or null. */
export function findEvidence(doc: Doc, evidence: string, near: number, window: number): number | null {
  const forms = evidenceForms(evidence)
  if (forms.length === 0) return null
  const holds = (n: number) => n >= 1 && n <= doc.texts.length && forms.some((f) => collapse(doc.texts[n - 1]).includes(f))
  for (let distance = 0; distance <= window; distance += 1) {
    for (const n of distance === 0 ? [near] : [near + distance, near - distance]) if (holds(n)) return n
  }
  return null
}

/** True when the evidence is in the code somewhere. Used for a drop, whose proof may be far from the comment. */
const evidenceAnywhere = (doc: Doc, evidence: string): number | null => findEvidence(doc, evidence, 1, doc.texts.length)

/** Every line number a reason names ("line 205", "lines 84-89", "the append at 386 and 395"), ranges expanded. */
export function linesNamed(reason: string): number[] {
  const named: number[] = []
  const add = (from: number, to: number) => {
    for (let n = from; n <= Math.min(to, from + 40); n += 1) named.push(n)
  }
  for (const m of reason.matchAll(/\blines?\s+(\d+)(?:\s*(?:-|\u2013|to|and|,)\s*(\d+))?/gi)) add(Number(m[1]), m[2] === undefined ? Number(m[1]) : Number(m[2]))
  // "The append at 386 and 395": a bare number after at or on, unless it is a size or a duration.
  for (const m of reason.matchAll(/\b(?:at|on)\s+(\d{1,5})(?:\s+and\s+(\d{1,5}))?(?!\d)(?!\s*(?:hex|char|byte|bit|ms\b|s\b|%|px|chars|characters|digits))/gi)) {
    add(Number(m[1]), Number(m[1]))
    if (m[2] !== undefined) add(Number(m[2]), Number(m[2]))
  }
  return named
}

interface Settled {
  line: number
  verdict: Verdict
  decidedBy: Decider
  reason: string
  evidence: string | null
}

/** A line that opens a function, class or type: a comment about its body belongs on a line of the body. */
const DECLARATION = /^\s*(?:func|def|async\s+def|function|class|type|interface|export)\b/

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

function unconfirmed(candidate: Candidate, reason: string): Settled {
  return { line: candidate.line, verdict: 'unverified', decidedBy: 'none', reason, evidence: null }
}

/**
 * Turns one verdict into a settled comment, re-checking it against the code. A verdict is kept only when the code
 * it quotes is really on the line it names; otherwise the comment stays on screen as unverified, never as checked.
 */
export function settle(candidate: Candidate, raw: RawVerdict | undefined, doc: Doc): Settled {
  if (!raw) return unconfirmed(candidate, 'The second pass gave no verdict for this comment.')
  const reason = raw.reason || 'The second pass gave no reason.'
  const shown = clip(collapse(raw.evidence), 80)
  const lineCount = doc.texts.length
  const target = raw.line ?? candidate.line

  if (raw.verdict === 'keep' || raw.verdict === 'move') {
    // Both name the line the comment belongs on. Whether it counts as moved follows from where it ends up.
    if (target < 1 || target > lineCount || Math.abs(target - candidate.line) > MAX_MOVE) {
      return unconfirmed(candidate, `Not confirmed: the second pass named line ${target}, which is outside what a move may reach.`)
    }
    if (doc.why[target - 1] !== null) {
      return unconfirmed(candidate, `Not confirmed: the second pass named line ${target}, which cannot carry a comment.`)
    }
    // A comment that quotes code sits where that code is. A move away from the quote's own line, to a line with no
    // such quote near it, is not a correction: the first pass had the line right and the second pass lost it.
    if (target !== candidate.line && candidate.quote.length >= MIN_QUOTE_CHARS) {
      const home = collapse(doc.texts[candidate.line - 1]).includes(collapse(candidate.quote))
      if (home && findEvidence(doc, candidate.quote, target, QUOTE_WINDOW) === null) {
        return unconfirmed(candidate, `Not confirmed: the second pass moved it to line ${target}, away from the code it quotes on line ${candidate.line}.`)
      }
    }
    const at = findEvidence(doc, raw.evidence, target, KEEP_WINDOW)
    if (at === null || doc.why[at - 1] !== null) {
      return unconfirmed(candidate, `Not confirmed: the second pass quoted "${shown}", which is not on line ${target}.`)
    }
    // The reason and the line must agree. The live SHA-1 comment sat on line 200 while its reason said "cnonce at line 205",
    // and the live aliasing comment sat on the signature of walk while its reason said "the append at 386 and 395".
    // A reason that names other lines and none near the comment is held against it when a named line holds the code the
    // comment's message names and the comment's own line does not, or when the comment sits on a declaration line, which
    // is where a comment about the body is most often misplaced. A reason may otherwise cite other lines for context.
    const names = codeNames(candidate.message)
    const holds = (n: number) => doc.why[n - 1] === null && names.some((name) => doc.texts[n - 1].includes(name))
    const named = linesNamed(reason).filter((n) => n >= 1 && n <= lineCount && Math.abs(n - at) <= 25)
    if (named.length > 0 && !named.some((n) => Math.abs(n - at) <= 1)) {
      const declaration = DECLARATION.test(doc.texts[at - 1])
      const pointedAt = named.find((n) => Math.abs(n - at) <= 10 && holds(n) && !holds(at)) ?? (declaration ? named[0] : undefined)
      if (pointedAt !== undefined) {
        return unconfirmed(candidate, `Not confirmed: the second pass's reason points at line ${pointedAt}, but the comment sits on line ${at}.`)
      }
    }
    return { line: at, verdict: at === candidate.fromLine ? 'kept' : 'moved', decidedBy: 'verifier', reason, evidence: shown }
  }

  if (raw.verdict === 'drop') {
    const at = evidenceAnywhere(doc, raw.evidence)
    if (at === null) {
      return unconfirmed(candidate, `Not confirmed: the second pass wanted to drop it and quoted "${shown}", which is not in the code.`)
    }
    return { line: candidate.line, verdict: 'dropped', decidedBy: 'verifier', reason, evidence: shown }
  }

  return unconfirmed(candidate, 'The second pass gave a verdict this page does not recognise.')
}

export interface Located {
  text: string
  where: ReviewComment['where']
}

/** Builds the comment list: every first-pass comment appears once, kept, moved, dropped or unverified. */
export function assemble(
  candidates: Candidate[],
  checkedDrops: CheckedDrop[],
  verdicts: Map<number, RawVerdict> | null,
  doc: Doc,
  locate: (line: number) => Located,
): ReviewComment[] {
  const make = (
    base: { id: number; fromLine: number; severity: ReviewComment['severity']; message: string; suggestion: string },
    s: Settled,
  ): ReviewComment => {
    const at = locate(s.line)
    const { id, fromLine, severity, message, suggestion } = base
    return { id, fromLine, severity, message, suggestion, line: s.line, verdict: s.verdict, decidedBy: s.decidedBy, reason: s.reason, evidence: s.evidence, code: at.text, where: at.where }
  }
  const settled = candidates.map((c) => {
    const s =
      verdicts === null
        ? unconfirmed(c, 'The second pass did not finish, so only the deterministic checks ran on this comment.')
        : settle(c, verdicts.get(c.id), doc)
    const note = c.loweredFrom ? ` Severity lowered from ${c.loweredFrom}: the comment itself says the code is safe.` : ''
    return make(c, { ...s, reason: `${s.reason}${note}` })
  })
  const dropped = checkedDrops.map((d) =>
    make(d, { line: d.line, verdict: 'dropped', decidedBy: 'check', reason: d.reason, evidence: null }),
  )
  return [...settled, ...dropped].sort((a, b) => a.id - b.id)
}
