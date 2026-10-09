import type { Severity } from '../../src/types'
import { anchorLine, endsWithNoChangeVerdict, lastSentence, suggestionLeavesCode, type Doc } from './anchor'
import { contradictedByScope } from './claims'

export { codeNames, endsWithNoChangeVerdict, suggestionLeavesCode } from './anchor'

const MIN_COMMENTS = 5
const MAX_COMMENTS = 15
const LINES_PER_COMMENT = 15
const MAX_TEXT_CHARS = 600
const SEVERITIES: Severity[] = ['critical', 'warning', 'info']

/** About one comment per 15 lines, at least five, and never more than the file has lines. */
export function commentBudget(lineCount: number): number {
  const scaled = Math.max(MIN_COMMENTS, Math.min(MAX_COMMENTS, Math.ceil(lineCount / LINES_PER_COMMENT)))
  return Math.min(scaled, lineCount)
}

/** Extracts the first complete JSON object, ignoring braces inside string literals. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function buildSystemPrompt(lang: string, lineCount: number, maxComments: number): string {
  return `You are an expert ${lang} reviewer. You return JSON and nothing else.

The file below is presented with a line number, a tab and a pipe in front of every line:

  12\t| const total = items.length

That prefix is display scaffolding, not source code. Never quote it back in a message or
suggestion, and never count lines yourself — the "line" field of each comment MUST be the
number printed in front of the line you are commenting on.

Respond with valid JSON in exactly this shape, with no markdown fence and no prose:
{
  "comments": [
    {
      "line": <integer between 1 and ${lineCount}>,
      "quote": "<the exact code fragment this comment is about, copied verbatim from that line>",
      "severity": "critical" | "warning" | "info",
      "message": "<what is wrong, one or two sentences>",
      "suggestion": "<the specific change to make>",
      "issue": <true only if something should change; false if, on reflection, the code is fine>
    }
  ]
}

Severity guidelines. Judge what the code does today, not what it could become:
- critical: only an exploitable security hole, a crash, data loss, or a definite bug on a path the
  code can actually reach. If you cannot name the input that triggers the harm, it is not critical.
  A type cast, a style problem, a missing check on a safe path or a theoretical risk is never critical.
- warning: performance problems, deprecated patterns, likely bugs, code smells
- info: style, best practice and refactoring opportunities

Coverage rules:
- This file has ${lineCount} lines. Read all of it, then divide it into ${maxComments} regions of
  roughly ${Math.ceil(lineCount / maxComments)} lines each and report the most important issue in
  each region. Aim for ${maxComments} comments in total; return fewer only where a region genuinely
  has nothing worth flagging. Never cluster your findings in the opening lines.
- Sort the comments by line number, ascending. Never file two comments on the same line.
- Only cite lines that exist, from 1 to ${lineCount}. A comment carrying any other line number is
  discarded before the user sees it.
- Every comment is about code on the line it cites, never a blank line. "quote" is the few words or the
  line the comment is about: for a typo or a name, that word or phrase itself, copied exactly. A comment
  whose quoted code is not on or near its line is moved or discarded.
- A comment that concludes the code is fine, safe or correct is not a finding. Leave it out. If you
  notice while writing that there is nothing to change, set "issue" to false and it is discarded.
- Every suggestion is a concrete change to the code. Never write "leave as-is", "keep it" or "no change needed":
  if the best advice is to change nothing, there is no comment.
- Do not comment on a deprecated member that is kept for compatibility, or on a parameter that an interface or
  callback signature requires (for example the request argument of an http.HandlerFunc), unless you propose a
  concrete change that keeps the code compatible.
- Only state what the file shows. Do not claim what another file, package or call does unless it is in this file.
- If the code has no real issues anywhere, return {"comments": []}.`
}

/** The system prompt for a pull request diff: comments sit on changed lines, and unchanged lines are context only. */
export function buildPrPrompt(lineCount: number, changedCount: number, maxComments: number): string {
  return `You are an expert code reviewer reading a pull request diff. You return JSON and nothing else.

The diff is presented with a line number, a tab and a pipe in front of every line:

  12\t| +    const total = items.length

That prefix is display scaffolding. After it, a line starting with + was added, a line starting with - was removed,
a line starting with a space is unchanged context, \`=== path (status)\` starts a file and \`@@ ... @@\` starts a hunk.
Never quote the prefix back, and never count lines yourself: the "line" field MUST be the number printed in front of
the line you are commenting on.

Respond with valid JSON in exactly this shape, with no markdown fence and no prose:
{
  "comments": [
    {
      "line": <integer between 1 and ${lineCount}>,
      "quote": "<the exact code fragment this comment is about, copied verbatim from that line, without the leading + or ->",
      "severity": "critical" | "warning" | "info",
      "message": "<what is wrong with this change, one or two sentences>",
      "suggestion": "<the specific change to make>",
      "issue": <true only if something should change; false if, on reflection, the change is fine>
    }
  ]
}

Review only the change. A comment must sit on a line that starts with + or -, never on context, a file line or a hunk
line. Use unchanged context only to understand the change.
Severity: critical is only an exploitable security hole, a crash, data loss or a definite bug the change introduces on
a reachable path; warning is a likely bug, performance problem or smell; info is style or refactoring.
This diff has ${lineCount} numbered lines, ${changedCount} of them changed. Report the most important issue in
each region of the changes, up to ${maxComments} comments, fewer where a region has nothing worth flagging. Sort by
line number and never file two comments on one line. Every suggestion is a concrete change: never write "leave
as-is". A comment that concludes the change is fine is not a finding: leave it out, or set "issue" to false. Only
state what the diff shows. If the change has no real issues, return {"comments": []}.`
}

function readObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Reads the model's reply as a review: a JSON object with a comments array, tolerating a
 * code fence or prose around it. Anything else is null, so it can never read as "no issues".
 */
export function parseReview(text: string): Record<string, unknown> | null {
  // The live model sometimes answers with the bare array of comments instead of {"comments": [...]}. A reply that is
  // wholly one JSON array is that list; the first object inside an array is never read as the review.
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  if (cleaned.startsWith('[')) {
    try {
      const list: unknown = JSON.parse(cleaned)
      if (Array.isArray(list)) return { comments: list }
    } catch {
      return null
    }
  }
  const review = parseJsonObject(text)
  return review && Array.isArray(review.comments) ? review : null
}

/** The first JSON object in a reply, tolerating a code fence or prose around it. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  return readObject(cleaned) ?? readObject(extractJsonObject(cleaned) ?? '')
}

/** A first-pass comment that survived the checks, ready for the second pass. */
export interface Candidate {
  id: number
  /** The line the comment sits on after the checks. */
  line: number
  /** The line the first pass cited. */
  fromLine: number
  quote: string
  severity: Severity
  message: string
  suggestion: string
  /** Set when the checks moved the comment, saying why. */
  moveNote: string | null
  /** The severity the first pass gave, when the checks lowered it because the message calls the code safe. */
  loweredFrom: Severity | null
}

// A message that rates a problem warning or critical while saying in the same breath that it is not one.
const SELF_CALLED_SAFE = /\b(?:not a crash|no crash|will not crash|cannot crash|safe today|safe in practice|guarded earlier|harmless|no (?:real )?(?:harm|risk)|which is correct|is correct here|works as intended)\b/i

/** A first-pass comment the checks removed, with the reason. */
export interface CheckedDrop {
  id: number
  line: number
  fromLine: number
  severity: Severity
  message: string
  suggestion: string
  reason: string
}

export interface Prechecked {
  candidates: Candidate[]
  dropped: CheckedDrop[]
  /** Items with no usable severity, message or suggestion: nothing can be shown for them. */
  malformed: number
}

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

/**
 * The deterministic checks on the first pass, before any second model. Every comment ends up as a candidate or as a
 * drop with a reason; only an item with no readable text, severity or line number is counted as malformed.
 */
export function precheck(raw: unknown, doc: Doc, budget: number): Prechecked {
  const lineCount = doc.texts.length
  const list: unknown[] = Array.isArray(raw) ? raw : []
  const candidates: Candidate[] = []
  const dropped: CheckedDrop[] = []
  let malformed = 0
  list.forEach((item, index) => {
    const id = index + 1
    const c = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TEXT_CHARS) : null)
    const message = c && text(c.message)
    const suggestion = c && text(c.suggestion)
    if (!c || !message || !suggestion || typeof c.line !== 'number' || !Number.isFinite(c.line) || !SEVERITIES.includes(c.severity as Severity)) {
      malformed += 1
      return
    }
    const severity = c.severity as Severity
    const cited = Math.round(c.line)
    const drop = (reason: string) =>
      dropped.push({ id, line: Math.min(Math.max(cited, 1), lineCount), fromLine: cited, severity, message, suggestion, reason })
    // A line outside the file is a hallucinated citation, not a roundable value.
    if (!Number.isInteger(c.line) || c.line < 1 || c.line > lineCount) {
      drop(`Cited line ${cited}, which is outside the ${lineCount} numbered lines.`)
      return
    }
    // Only an explicit false is a verdict. A reply that leaves the field out is not read as "no issue".
    if (c.issue === false) {
      drop('The reviewer marked its own comment as not an issue.')
      return
    }
    if (endsWithNoChangeVerdict(message)) {
      drop(`Concludes that nothing should change: "${short(lastSentence(message), 90)}"`)
      return
    }
    if (suggestionLeavesCode(suggestion)) {
      drop(`Proposes no change: "${short(suggestion, 90)}"`)
      return
    }
    // A comment that says a call is missing ("never closed") is false when the scope of its line makes the call.
    const contradiction = contradictedByScope(message, suggestion, doc.texts, cited, (n) => doc.sides?.[n - 1] === 'del')
    if (contradiction) {
      drop(`The comment says it is never ${contradiction.what === 'close' ? 'closed' : contradiction.what === 'release' ? 'released' : 'awaited'}, but the code in its scope does: "${short(contradiction.text, 70)}" (line ${contradiction.at}).`)
      return
    }
    const quote = typeof c.quote === 'string' ? c.quote.trim() : ''
    const anchor = anchorLine(doc, cited, quote, message)
    if ('dropped' in anchor) {
      const reasons = {
        blank: 'Cited a blank line, and the code it quotes is not nearby.',
        context: 'Cited an unchanged line of the diff. Comments may only sit on changed lines.',
        unfound: `The code it quotes ("${short(quote, 60)}") is not on or near line ${cited}.`,
      }
      drop(reasons[anchor.dropped])
      return
    }
    if (candidates.length >= budget) {
      drop(`Over the limit of ${budget} comments for this size.`)
      return
    }
    const moveNote =
      anchor.line === cited
        ? null
        : anchor.movedBy === 'name'
          ? `Moved by the checks from line ${cited}: the code it names is on line ${anchor.line}.`
          : `Moved by the checks from line ${cited}: the code it quotes is on line ${anchor.line}.`
    const lowered = severity !== 'info' && SELF_CALLED_SAFE.test(message)
    candidates.push({ id, line: anchor.line, fromLine: cited, quote, severity: lowered ? 'info' : severity, message, suggestion, moveNote, loweredFrom: lowered ? severity : null })
  })
  return { candidates, dropped, malformed }
}
