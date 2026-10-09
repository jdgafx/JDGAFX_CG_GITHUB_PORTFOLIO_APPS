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
      "quote": "<the exact code of that line, copied verbatim without the line number prefix>",
      "severity": "critical" | "warning" | "info",
      "message": "<what is wrong, one or two sentences>",
      "suggestion": "<the specific change to make>"
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
- Every comment is about code on the line it cites, never a blank line. Copy that line into "quote".
  A comment whose line is blank, or does not hold the quoted code, is moved or discarded.
- A comment that concludes the code is fine, safe or correct is not a finding. Leave it out.
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
  /** Every candidate that was not kept: invalid, on a blank line, or over the budget. */
  dropped: number
  /** Of those, the ones that cited a blank line the quote could not place. */
  droppedBlank: number
  /** Kept comments moved to the nearby line that holds the code they quote. */
  moved: number
}

const NEARBY_OFFSETS = [1, -1, 2, -2]
const MIN_QUOTE_CHARS = 3

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** True when the quote and the line hold the same code, ignoring spacing. Very short strings never match. */
function holdsQuote(lineText: string, quote: unknown): boolean {
  if (typeof quote !== 'string') return false
  const a = collapse(lineText)
  const b = collapse(quote)
  return Math.min(a.length, b.length) >= MIN_QUOTE_CHARS && (a.includes(b) || b.includes(a))
}

/**
 * Where a comment should sit. A cited line that holds code stays unless the comment quotes other code that
 * sits within two lines, and then it moves there. A blank line is only replaced by a nearby line that holds
 * the quote, and is otherwise null, so a comment never points at nothing.
 */
function anchorLine(lines: string[], line: number, quote: unknown): number | null {
  const cited = lines[line - 1]
  const blank = cited.trim() === ''
  if (!blank && (typeof quote !== 'string' || collapse(quote) === '' || holdsQuote(cited, quote))) return line
  for (const offset of NEARBY_OFFSETS) {
    const near = line + offset
    if (near >= 1 && near <= lines.length && holdsQuote(lines[near - 1], quote)) return near
  }
  return blank ? null : line
}

/** Keeps only comments that cite a real line of `lines` and carry valid fields, at most `budget` of them. */
export function validateComments(raw: unknown, lines: string[], budget: number): ValidatedComments {
  const lineCount = lines.length
  const list: unknown[] = Array.isArray(raw) ? raw : []
  let droppedBlank = 0
  let moved = 0
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
    const line = anchorLine(lines, c.line as number, c.quote)
    if (line === null) {
      droppedBlank += 1
      continue
    }
    if (line !== c.line) moved += 1
    comments.push({
      line,
      severity: c.severity as Severity,
      message: (c.message as string).trim().slice(0, MAX_TEXT_CHARS),
      suggestion: (c.suggestion as string).trim().slice(0, MAX_TEXT_CHARS),
    })
  }
  const kept = comments.slice(0, budget)
  return { comments: kept, dropped: list.length - kept.length, droppedBlank, moved }
}
