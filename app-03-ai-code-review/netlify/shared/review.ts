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
      "severity": "critical" | "warning" | "info",
      "message": "<what is wrong, one or two sentences>",
      "suggestion": "<the specific change to make>"
    }
  ]
}

Severity guidelines:
- critical: security vulnerabilities, bugs that throw or corrupt data, data loss risks
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

/** Keeps only comments that cite a real line and carry valid fields, at most `budget` of them. */
export function validateComments(
  raw: unknown,
  lineCount: number,
  budget: number,
): { comments: ReviewComment[]; dropped: number } {
  const list: unknown[] = Array.isArray(raw) ? raw : []
  const comments = list
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    // A line outside the file is a hallucinated citation, not a roundable value: drop it.
    .filter(
      (c) =>
        typeof c.line === 'number' &&
        Number.isInteger(c.line) &&
        c.line >= 1 &&
        c.line <= lineCount &&
        typeof c.severity === 'string' &&
        SEVERITIES.includes(c.severity as Severity) &&
        typeof c.message === 'string' &&
        c.message.trim().length > 0 &&
        typeof c.suggestion === 'string' &&
        c.suggestion.trim().length > 0,
    )
    .slice(0, budget)
    .map((c) => ({
      line: c.line as number,
      severity: c.severity as Severity,
      message: (c.message as string).trim().slice(0, MAX_TEXT_CHARS),
      suggestion: (c.suggestion as string).trim().slice(0, MAX_TEXT_CHARS),
    }))
  return { comments, dropped: list.length - comments.length }
}
