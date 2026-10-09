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
  /** Of those, comments that found nothing to change: marked issue: false, or ending with a no-change verdict. */
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
/** How far from the cited line the code names in a message are searched for. */
const NAME_WINDOW = 20
const MIN_QUOTE_CHARS = 3

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The last sentence of a message. A sentence ends at . ! or ? followed by a capital, a quote or a bracket. */
function lastSentence(message: string): string {
  const parts = message.trim().split(/(?<=[.!?])\s+(?=[A-Z`"'(])/)
  return (parts[parts.length - 1] ?? '').replace(/[\s"'`)\].!?]+$/, '')
}

// The final words of a comment that says nothing needs to change: "so this is safe", "which is fine as written",
// "this is only a note on the copy helper", "no issue here". A reason after it ("since ...") is allowed, but a
// turn ("but", "however") is not: that is a finding again.
const TURN = String.raw`(?:but|however|though|although|yet)`
const VERDICT = new RegExp(
  String.raw`\b(?:` +
    String.raw`(?:is|are|looks?|seems?|appears?|remains?|stays?|was)\s+(?:safe|fine|correct|okay|ok|harmless|acceptable|valid|sound|intended|expected|not a (?:bug|problem|concern|issue))` +
    String.raw`|(?:(?:is|are)\s+)?(?:only|just|merely)\s+(?:a\s+|an\s+)?(?:note|remark|observation|nit|nitpick|fyi|cosmetic|stylistic)` +
    String.raw`|(?:there\s+is|there's|this\s+is|that\s+is|it\s+is)\s+(?:no|not an?)\s+(?:issue|problem|bug|concern)` +
    String.raw`|no\s+(?:issue|problem|bug|change|action|fix)(?:\s+(?:is\s+)?(?:needed|required|necessary))?` +
    String.raw`|nothing\s+(?:to\s+(?:change|fix|do)|needs\s+to\s+(?:change|be\s+(?:changed|fixed)))` +
    String.raw`)` +
    String.raw`(?:\s+(?:here|as\s+written|as\s+is|in\s+practice|in\s+this\s+case|today|for\s+now))*` +
    String.raw`(?:\s+(?:since|because|as|on|about|regarding|for|in|with|given)\b(?:(?!\b${TURN}\b)[^.!?])*)?$`,
  'i',
)
const CHANGE_CUE = new RegExp(
  String.raw`\b(?:should|could|consider|might\s+want|recommend|ought|must|needs?\s+to|better\s+to|prefer|instead|would\s+be\s+(?:clearer|better|safer|cleaner|simpler)|${TURN},?\s+(?:add|use|remove|rename|replace|extract|simplify|avoid|document|check|guard|validate))\b`,
  'i',
)

/** True when the message ends by saying the code is fine and its last sentence proposes no change. */
export function endsWithNoChangeVerdict(message: string): boolean {
  const sentence = lastSentence(message)
  return VERDICT.test(sentence) && !CHANGE_CUE.test(sentence)
}

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g
const codeLike = (name: string) => /[a-z0-9][A-Z]|_/.test(name)

/**
 * Names of code a message talks about: anything in backticks, a call such as foo(), a dotted name, and
 * camelCase, CamelCase or snake_case words. A dotted name also stands for each part that looks like code.
 */
export function codeNames(message: string): string[] {
  const names = new Set<string>()
  const add = (name: string) => {
    if (name.length >= MIN_QUOTE_CHARS) names.add(name)
  }
  const take = (text: string, strong: boolean) => {
    for (const match of text.matchAll(IDENTIFIER)) {
      const name = match[0]
      const call = text[(match.index ?? 0) + name.length] === '('
      if (!(strong || call || name.includes('.') || codeLike(name))) continue
      add(name)
      for (const part of name.split('.')) if (strong || call || codeLike(part)) add(part)
    }
  }
  for (const quoted of message.matchAll(/`([^`]+)`/g)) take(quoted[1], true)
  take(message.replace(/`[^`]*`/g, ' '), false)
  return [...names]
}

type Anchor = { line: number } | { dropped: 'blank' | 'unfound' }

/**
 * Where a comment should sit, in two steps.
 * 1. The quote, the code fragment the comment is about. If the cited line holds it, the comment stays. Otherwise it
 *    moves to the nearest line within ten that holds it, or to the only line in the file that does. A quote found
 *    nowhere drops the comment. A comment with no usable quote keeps a code line and loses a blank one.
 * 2. The names of code in the message. If the line from step 1 holds none of them but exactly one line within twenty
 *    does, the comment moves there. When the message names nothing, or nothing is found, the line stands. A blank
 *    line with no such line to go to drops the comment.
 */
function anchorLine(lines: string[], line: number, quote: unknown, message: string): Anchor {
  const fragment = typeof quote === 'string' ? collapse(quote) : ''
  let at: number | null = line
  if (fragment.length >= MIN_QUOTE_CHARS) {
    const holds = (n: number) => collapse(lines[n - 1]).includes(fragment)
    at = null
    if (holds(line)) at = line
    for (let distance = 1; at === null && distance <= QUOTE_WINDOW; distance += 1) {
      for (const near of [line + distance, line - distance]) {
        if (at === null && near >= 1 && near <= lines.length && holds(near)) at = near
      }
    }
    if (at === null) {
      const hits = lines.flatMap((_, i) => (holds(i + 1) ? [i + 1] : []))
      if (hits.length !== 1) return { dropped: lines[line - 1].trim() === '' ? 'blank' : 'unfound' }
      at = hits[0]
    }
  } else if (lines[line - 1].trim() === '') {
    at = null
  }

  const names = codeNames(message)
  const has = (n: number) => names.some((name) => lines[n - 1].includes(name))
  if (names.length > 0 && (at === null || !has(at))) {
    const centre = at ?? line
    const near = lines.flatMap((_, i) => (Math.abs(i + 1 - centre) <= NAME_WINDOW && has(i + 1) ? [i + 1] : []))
    if (near.length === 1) at = near[0]
  }
  return at === null ? { dropped: 'blank' } : { line: at }
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
    // A message that ends by calling the code fine counts the same, whatever the flag says.
    if (c.issue === false || endsWithNoChangeVerdict(c.message as string)) {
      counts.noIssue += 1
      continue
    }
    const anchor = anchorLine(lines, c.line as number, c.quote, c.message as string)
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
