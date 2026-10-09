// Deterministic checks on where a comment sits and whether it proposes a change. No model is involved.

/** How far from the cited line a quote is searched for. A quote found only once in the whole file also counts. */
export const QUOTE_WINDOW = 10
/** How far from the cited line the code names in a message are searched for. */
export const NAME_WINDOW = 20
export const MIN_QUOTE_CHARS = 3

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The last sentence of a message. A sentence ends at . ! or ? followed by a capital, a quote or a bracket. */
export function lastSentence(message: string): string {
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
    String.raw`|(?:(?:is|are|was|were)\s+)?kept\s+(?:only\s+)?(?:for|as)\s+(?:backwards?[- ]?)?compat(?:ibility)?` +
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
  // A hash or digest named in prose (SHA-1, MD5) is the call that uses it, such as hashlib.sha1.
  for (const hash of message.matchAll(/\b(?:SHA-?\d{1,3}|MD5|CRC32)\b/gi)) add(hash[0].replace('-', '').toLowerCase())
  for (const quoted of message.matchAll(/`([^`]+)`/g)) take(quoted[1], true)
  take(message.replace(/`[^`]*`/g, ' '), false)
  return [...names]
}

/** The numbered lines a comment can be placed on: `why` says what makes a line unusable, null when it can carry one. */
export interface Doc {
  texts: string[]
  why: Array<'blank' | 'context' | null>
  /** In a diff, whether each line was added or removed. Absent for a file. */
  sides?: Array<'add' | 'del' | null>
}

/** A pasted or loaded file: every non-blank line can carry a comment. */
export function fileDoc(lines: string[]): Doc {
  return { texts: lines, why: lines.map((l) => (l.trim() === '' ? 'blank' : null)) }
}

/** A pull request diff: only added and removed lines can carry a comment. Context and header lines cannot. */
export function diffDoc(units: Array<{ text: string; kind: 'meta' | 'ctx' | 'add' | 'del' }>): Doc {
  return {
    texts: units.map((u) => u.text),
    sides: units.map((u) => (u.kind === 'add' || u.kind === 'del' ? u.kind : null)),
    why: units.map((u) => {
      if (u.kind === 'ctx') return 'context'
      if (u.kind === 'meta' || u.text.trim() === '') return 'blank'
      return null
    }),
  }
}

/** Names a line declares: `x :=`, `x =` (not `==`), `def x`, `func x`, `class x`, `var x`, `let x`, `const x`. */
export function declaredNames(line: string): Set<string> {
  const names = new Set<string>()
  for (const m of line.matchAll(/\b([A-Za-z_]\w*)\s*(?::=|=(?![=>]))/g)) names.add(m[1])
  for (const m of line.matchAll(/\b(?:def|func|function|class|type|var|let|const)\s+([A-Za-z_]\w*)/g)) names.add(m[1])
  return names
}

/** A message that is about a name itself: shadowing, declaring, renaming. Its subject is the declaration, not the later uses. */
export const ABOUT_A_NAME = /\b(?:shadow\w*|declar\w*|redeclar\w*|renam\w*|naming|variable name|parameter name|identifier)\b/i

/** Every identifier-like word of a message, for matching against declared names. */
export function messageWords(message: string): Set<string> {
  return new Set(message.match(/[A-Za-z_]\w*/g) ?? [])
}

export type Anchor = { line: number; movedBy: 'quote' | 'name' | null } | { dropped: 'blank' | 'context' | 'unfound' }

const holdsQuote = (doc: Doc, n: number, fragment: string) => doc.why[n - 1] === null && collapse(doc.texts[n - 1]).includes(fragment)

/**
 * Where a comment should sit, in two steps.
 * 1. The quote, the code fragment the comment is about. If the cited line holds it, the comment stays. Otherwise it
 *    moves to the nearest usable line within ten that holds it, or to the only line in the file that does. A quote found
 *    nowhere drops the comment. A comment with no usable quote keeps a usable line and loses an unusable one.
 * 2. The names of code in the message. If the line from step 1 holds none of them but exactly one usable line within
 *    twenty does, the comment moves there. When the message names nothing, or nothing is found, the line stands.
 */
export function anchorLine(doc: Doc, line: number, quote: unknown, message: string): Anchor {
  const lineCount = doc.texts.length
  const fragment = typeof quote === 'string' ? collapse(quote) : ''
  const citedWhy = doc.why[line - 1]
  let at: number | null = line
  let byName = false
  if (fragment.length >= MIN_QUOTE_CHARS) {
    const holds = (n: number) => holdsQuote(doc, n, fragment)
    at = null
    if (holds(line)) at = line
    for (let distance = 1; at === null && distance <= QUOTE_WINDOW; distance += 1) {
      for (const near of [line + distance, line - distance]) {
        if (at === null && near >= 1 && near <= lineCount && holds(near)) at = near
      }
    }
    if (at === null) {
      const hits = doc.texts.flatMap((_, i) => (holds(i + 1) ? [i + 1] : []))
      if (hits.length !== 1) return { dropped: citedWhy ?? 'unfound' }
      at = hits[0]
    }
  } else if (citedWhy !== null) {
    at = null
  }

  const names = codeNames(message)
  const has = (n: number) => doc.why[n - 1] === null && names.some((name) => doc.texts[n - 1].includes(name))
  // A line that declares a name the message is about is where the comment belongs: a later use of the name never pulls it away
  // (the live `path := req.URL.Path` shadowing comment, pulled to `cleanPath(path)` five lines below).
  const words = messageWords(message)
  const declaresSubject = at !== null && ABOUT_A_NAME.test(message) && [...declaredNames(doc.texts[at - 1])].some((name) => words.has(name))
  if (!declaresSubject && names.length > 0 && (at === null || !has(at))) {
    const centre = at ?? line
    const near = doc.texts.flatMap((_, i) => (Math.abs(i + 1 - centre) <= NAME_WINDOW && has(i + 1) ? [i + 1] : []))
    if (near.length === 1) {
      at = near[0]
      byName = true
    }
  }
  if (at === null) return { dropped: citedWhy ?? 'blank' }
  return { line: at, movedBy: byName ? 'name' : at !== line ? 'quote' : null }
}

// A suggestion whose first clause says to change nothing: "Leave as-is for backward compatibility, but ...",
// "Keep it in place", "No change needed".
const LEAVE_SUGGESTION = new RegExp(
  String.raw`^\W*(?:(?:just|simply|probably)\s+)?(?:` +
    String.raw`(?:leave|keep)\b[^,.;]{0,60}?\b(?:as[- ]is|in\s+place|unchanged|as\s+(?:it\s+is|written|they\s+are)|alone)\b` +
    String.raw`|no\s+(?:change|action|fix)(?:s)?\b` +
    String.raw`|nothing\s+to\s+(?:change|fix|do)\b` +
    String.raw`)`,
  'i',
)

/** True when the suggestion's first clause keeps the code as it is, so the comment proposes no change. */
export function suggestionLeavesCode(suggestion: string): boolean {
  return LEAVE_SUGGESTION.test(suggestion.trim())
}
