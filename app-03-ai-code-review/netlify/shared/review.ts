import type { ReviewComment, Severity } from '../../src/types'

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
- If the code has no real issues anywhere, return {"comments": []}.`
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
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const review = readObject(cleaned) ?? readObject(extractJsonObject(cleaned) ?? '')
  return review && Array.isArray(review.comments) ? review : null
}

export interface ValidatedComments {
  comments: ReviewComment[]
  /** Every candidate that was not kept, for any reason. */
  dropped: number
  /** Of those, comments the model itself marked as finding nothing to change. */
  droppedNoIssue: number
  /** Of those, comments that cited a blank line the quote could not place. */
  droppedBlank: number
  /** Of those, comments whose quoted code is not in the file. */
  droppedUnfound: number
  /** Kept comments moved to the line that holds the code they quote. */
  moved: number
}

/** How far from the cited line a quote is searched for. A quote found only once in the whole file also counts. */
const QUOTE_WINDOW = 10
const MIN_QUOTE_CHARS = 3

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

type Anchor = { line: number } | { dropped: 'blank' | 'unfound' }

/**
 * Where a comment should sit. The quote is the code fragment the comment is about. If the cited line holds it, the
 * comment stays. Otherwise it moves to the nearest line within ten that holds it, or to the only line in the file
 * that does. A comment with no usable quote stays on a code line and is dropped on a blank one. A comment whose
 * quote is nowhere to be found is dropped, so it never points at code it is not about.
 */
function anchorLine(lines: string[], line: number, quote: unknown): Anchor {
  const fragment = typeof quote === 'string' ? collapse(quote) : ''
  const blank = lines[line - 1].trim() === ''
  if (fragment.length < MIN_QUOTE_CHARS) return blank ? { dropped: 'blank' } : { line }
  const holds = (n: number) => collapse(lines[n - 1]).includes(fragment)
  if (holds(line)) return { line }
  for (let distance = 1; distance <= QUOTE_WINDOW; distance += 1) {
    for (const near of [line + distance, line - distance]) {
      if (near >= 1 && near <= lines.length && holds(near)) return { line: near }
    }
  }
  const hits = lines.flatMap((_, i) => (holds(i + 1) ? [i + 1] : []))
  if (hits.length === 1) return { line: hits[0] }
  return { dropped: blank ? 'blank' : 'unfound' }
}

/** Keeps only comments that cite a real line of `lines` and carry valid fields, at most `budget` of them. */
export function validateComments(raw: unknown, lines: string[], budget: number): ValidatedComments {
  const lineCount = lines.length
  const list: unknown[] = Array.isArray(raw) ? raw : []
  const counts = { noIssue: 0, blank: 0, unfound: 0, moved: 0 }
  const comments: ReviewComment[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    // A line outside the file is a hallucinated citation, not a roundable value: drop it.
    const valid =
      typeof c.line === 'number' &&
      Number.isInteger(c.line) &&
      c.line >= 1 &&
      c.line <= lineCount &&
      typeof c.severity === 'string' &&
      SEVERITIES.includes(c.severity as Severity) &&
      typeof c.message === 'string' &&
      c.message.trim().length > 0 &&
      typeof c.suggestion === 'string' &&
      c.suggestion.trim().length > 0
    if (!valid) continue
    // Only an explicit false is a verdict. A reply that leaves the field out is not read as "no issue".
    if (c.issue === false) {
      counts.noIssue += 1
      continue
    }
    const anchor = anchorLine(lines, c.line as number, c.quote)
    if ('dropped' in anchor) {
      counts[anchor.dropped] += 1
      continue
    }
    if (anchor.line !== c.line) counts.moved += 1
    comments.push({
      line: anchor.line,
      severity: c.severity as Severity,
      message: (c.message as string).trim().slice(0, MAX_TEXT_CHARS),
      suggestion: (c.suggestion as string).trim().slice(0, MAX_TEXT_CHARS),
    })
  }
  const kept = comments.slice(0, budget)
  return {
    comments: kept,
    dropped: list.length - kept.length,
    droppedNoIssue: counts.noIssue,
    droppedBlank: counts.blank,
    droppedUnfound: counts.unfound,
    moved: counts.moved,
  }
}
