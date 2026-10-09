// The code a comment is about, not just the line it cites: the function or class that holds the line. The second pass
// reads this so it can follow a name to where it is defined (the live `open()` on line 148 for a claim made on line 191).

/** Longest scope sent for one comment. A longer function is cut around the cited line, keeping its signature. */
export const MAX_SCOPE_LINES = 40
/** The window used when no enclosing declaration can be found (top-level code). */
const FALLBACK_RADIUS = 20
const LOOKBACK = 400

const DECLARATION = /^\s*(?:(?:export|public|private|protected|static|async|default|abstract|final)\s+)*(?:func|def|function|class|interface|type\s+\w+\s+(?:struct|interface)|struct|impl|fn|sub)\b/
// `name(args) {` and `name = (args) =>`: a method or an arrow function in the C and JavaScript families.
const METHOD = /^\s*(?:(?:async|static|public|private|protected|get|set)\s+)*[A-Za-z_$][\w$]*\s*\([^;]*\)\s*(?::\s*[^{;]+)?\{\s*$/
const ARROW = /^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?=>\s*\{?\s*$/
const NOT_A_DECLARATION = /^\s*(?:if|for|while|switch|catch|else|return|try|do|with|elif|except)\b/

const indentOf = (line: string): number => {
  let n = 0
  for (const ch of line) {
    if (ch === ' ') n += 1
    else if (ch === '\t') n += 4
    else break
  }
  return n
}

const isBlank = (line: string) => line.trim() === ''

/** True for a line that opens a function, method, class or type. */
export function opensScope(line: string): boolean {
  if (NOT_A_DECLARATION.test(line)) return false
  return DECLARATION.test(line) || METHOD.test(line) || ARROW.test(line)
}

/** Net `{` minus `}` on a line, ignoring those inside simple string literals and after a line comment. */
function braceDelta(line: string): number {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '/' && line[i + 1] === '/') break
    else if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
  }
  return depth
}

/** The last line of the scope that starts at `start` (1-based): by braces when the signature has one, else by indentation. */
function scopeEnd(texts: readonly string[], start: number): number {
  const first = texts[start - 1]
  const braces = first.includes('{') || (texts[start] ?? '').trim() === '{'
  if (braces) {
    let depth = 0
    let opened = false
    for (let n = start; n <= texts.length && n <= start + 600; n += 1) {
      const d = braceDelta(texts[n - 1])
      if (d !== 0 || texts[n - 1].includes('{')) opened = true
      depth += d
      if (opened && depth <= 0) return n
    }
    return Math.min(texts.length, start + MAX_SCOPE_LINES)
  }
  const base = indentOf(first)
  let end = start
  for (let n = start + 1; n <= texts.length; n += 1) {
    if (isBlank(texts[n - 1])) continue
    if (indentOf(texts[n - 1]) <= base) break
    end = n
  }
  return end
}

export interface Scope {
  /** First and last line of the lines returned, 1-based. */
  from: number
  to: number
  /** The signature line when the scope was cut and the signature is not in the window; otherwise null. */
  signature: number | null
  /** True when a real enclosing declaration was found; false for the fallback window. */
  enclosing: boolean
}

/**
 * The function or class around `line` (1-based) in `texts`: found by walking back to a declaration indented less than the
 * line, then forward to where its braces or its indentation end. A scope longer than MAX_SCOPE_LINES is cut around the
 * cited line and keeps its signature. With no declaration (top-level code) a window of 20 lines either side is used.
 */
export function enclosingScope(texts: readonly string[], line: number): Scope {
  const count = texts.length
  const cited = texts[line - 1] ?? ''
  const citedIndent = isBlank(cited) ? Number.POSITIVE_INFINITY : indentOf(cited)
  let start = 0
  if (opensScope(cited)) start = line
  else {
    for (let n = line - 1; n >= 1 && n >= line - LOOKBACK; n -= 1) {
      const text = texts[n - 1]
      if (isBlank(text)) continue
      if (opensScope(text) && indentOf(text) < citedIndent) {
        start = n
        break
      }
    }
  }
  if (start === 0) {
    return { from: Math.max(1, line - FALLBACK_RADIUS), to: Math.min(count, line + FALLBACK_RADIUS), signature: null, enclosing: false }
  }
  const end = Math.max(line, scopeEnd(texts, start))
  if (end - start + 1 <= MAX_SCOPE_LINES) return { from: start, to: end, signature: null, enclosing: true }
  const half = Math.floor((MAX_SCOPE_LINES - 1) / 2)
  const from = Math.max(start + 1, line - half)
  const to = Math.min(end, from + MAX_SCOPE_LINES - 2)
  return { from, to, signature: start, enclosing: true }
}

/**
 * The scope as numbered lines (`N<TAB>| text`), the same form as the whole listing, with a gap marker when it was cut.
 * `code` is the text of each numbered line without any diff sign (used to find the scope); `shown` is what is printed.
 */
export function scopeListing(shown: readonly string[], code: readonly string[], line: number): string {
  const s = enclosingScope(code, line)
  const row = (n: number) => `${n}\t| ${shown[n - 1]}`
  const rows: string[] = []
  if (s.signature !== null) rows.push(row(s.signature), '...')
  for (let n = s.from; n <= s.to; n += 1) rows.push(row(n))
  return rows.join('\n')
}

const MAX_DEFINITIONS = 3
const DEFINITION_LINES = 18

/**
 * The definitions of the functions and classes a comment talks about, found by name: the comment says "open()" or "_f", the
 * file defines `def open(self)`, and the second pass needs to read that body to know whether `_f` can be None. A name counts
 * only when a line of the file defines it (def, func, function or class, including a Go method receiver). Definitions that sit
 * inside the cited line's own scope are left out, they are already shown.
 */
export function definitionListing(shown: readonly string[], code: readonly string[], text: string, line: number): string {
  const own = enclosingScope(code, line)
  const named = (text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []).filter((w) => !STOP.has(w.toLowerCase()))
  // Then the functions the scope itself calls (`self.open()` calls `def open`), nearest the cited line first.
  const calls: string[] = []
  for (let n = own.to; n >= own.from; n -= 1) {
    for (const m of (code[n - 1] ?? '').matchAll(/\b([A-Za-z_]\w{2,})\s*\(/g)) if (!STOP.has(m[1].toLowerCase()) && !CALL_STOP.has(m[1])) calls.push(m[1])
  }
  const words = new Set([...named, ...calls])
  const seen = new Set<number>()
  const rows: string[] = []
  for (const word of words) {
    const at = code.findIndex((l) => new RegExp(String.raw`^\s*(?:async\s+)?(?:def|function|class)\s+${word}\b|^\s*func\s+(?:\([^)]*\)\s*)?${word}\b`).test(l)) + 1
    if (at === 0 || seen.has(at) || (at >= own.from && at <= own.to) || seen.size >= MAX_DEFINITIONS) continue
    seen.add(at)
    const end = Math.min(scopeEnd(code, at), at + DEFINITION_LINES - 1)
    if (rows.length > 0) rows.push('...')
    for (let n = at; n <= end; n += 1) rows.push(`${n}\t| ${shown[n - 1]}`)
  }
  return rows.join('\n')
}

const CALL_STOP = new Set(['for', 'while', 'print', 'len', 'range', 'str', 'int', 'list', 'dict', 'set', 'tuple', 'isinstance', 'super', 'getattr', 'setattr', 'hasattr', 'not', 'and', 'min', 'max', 'sum', 'map', 'filter', 'make', 'append', 'panic', 'new', 'cast', 'type', 'bool', 'bytes', 'open_text', 'format'])

const STOP = new Set(['the', 'and', 'that', 'this', 'with', 'for', 'not', 'are', 'was', 'from', 'when', 'which', 'into', 'than', 'then', 'also', 'but', 'only', 'any', 'has', 'have', 'can', 'may', 'will', 'its', 'use', 'instead', 'should', 'call', 'calls', 'line', 'code', 'value', 'values', 'function', 'class', 'type', 'string', 'none', 'null', 'true', 'false', 'return', 'returns'])
