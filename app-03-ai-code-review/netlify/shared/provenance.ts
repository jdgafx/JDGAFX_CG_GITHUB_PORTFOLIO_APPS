// Where a value came from. A claim that a function mutates, aliases or deletes from "the caller's" object is only as good as
// the object's origin: `headers` that was returned by an imported `mergeConfig()` is a fresh copy, not the caller's. The
// provenance is traced by assignments in the file, a few steps up, with no model.

const LOOKBACK = 300
const MAX_DEPTH = 3
const MAX_NAMES = 3

const MUTATION = /\b(?:mutat\w*|modif\w*|alias\w*|shar(?:e|es|ed|ing)\b|delet\w*|overwrit\w*|in place|side effect)/i
const CALLER = /\b(?:caller|passed in|passed-in|argument|input|parameter|supplied|user-supplied|original)\b/i
const KEYWORDS = new Set(['delete', 'const', 'let', 'var', 'return', 'function', 'this', 'self', 'new', 'await', 'async', 'for', 'if', 'else', 'null', 'true', 'false', 'None', 'True', 'False', 'typeof', 'in', 'of', 'def', 'class'])

/** True for a claim about changing, sharing or deleting from an object the caller supplied. */
export function isMutationClaim(message: string): boolean {
  return MUTATION.test(message) && CALLER.test(message)
}

export type Origin =
  | { kind: 'call'; callee: string; line: number; defined: false }
  | { kind: 'call'; callee: string; line: number; defined: true; definition: number }
  | { kind: 'param' | 'literal' | 'unknown' }

export interface Trace {
  name: string
  /** The assignment lines followed, nearest first. */
  lines: number[]
  origin: Origin
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function findDefinition(texts: readonly string[], callee: string): number | null {
  const last = callee.split('.').pop() ?? callee
  const re = new RegExp(String.raw`^\s*(?:export\s+)?(?:async\s+)?(?:function\s+${esc(last)}\b|def\s+${esc(last)}\b|func\s+(?:\([^)]*\)\s*)?${esc(last)}\b|(?:const|let|var)\s+${esc(last)}\s*=\s*(?:async\s*)?(?:function|\())|^\s*(?:async\s+)?${esc(last)}\s*\([^)]*\)\s*\{\s*$`)
  const at = texts.findIndex((l) => re.test(l))
  return at === -1 ? null : at + 1
}

/** The nearest assignment to `name` above line `before`: its line, the right-hand side, and the source variable of a destructuring. */
function lastAssignment(texts: readonly string[], name: string, before: number): { line: number; rhs: string; destructured: boolean } | null {
  const n = esc(name)
  const direct = new RegExp(String.raw`(?:^|[^\w$.])(?:(?:const|let|var)\s+)?${n}\s*(?::=|=(?![=>]))\s*(.+?);?\s*$`)
  const destructure = new RegExp(String.raw`(?:const|let|var)\s*\{[^}]*\b${n}\b[^}]*\}\s*=\s*([A-Za-z_$][\w$.]*)`)
  for (let i = before - 1; i >= 1 && i >= before - LOOKBACK; i -= 1) {
    const text = texts[i - 1] ?? ''
    let m = destructure.exec(text)
    if (m) return { line: i, rhs: m[1], destructured: true }
    m = direct.exec(text)
    if (m && !/^\s*(?:\/\/|#|\*)/.test(text)) return { line: i, rhs: m[1], destructured: false }
  }
  return null
}

/** Follows `name` up through at most three assignments to where it came from. */
export function traceOrigin(texts: readonly string[], name: string, before: number, depth = 0, lines: number[] = []): Trace {
  if (depth >= MAX_DEPTH) return { name, lines, origin: { kind: 'unknown' } }
  const found = lastAssignment(texts, name, before)
  if (!found) return { name, lines, origin: { kind: 'param' } }
  const trail = [...lines, found.line]
  const rhs = found.rhs.trim()
  if (found.destructured) return traceOrigin(texts, rhs.split('.')[0], found.line, depth + 1, trail)
  const call = /^(?:await\s+)?(?:new\s+)?([A-Za-z_$][\w$.]*)\s*\(/.exec(rhs)
  if (call) {
    const definition = findDefinition(texts, call[1])
    return { name, lines: trail, origin: definition === null ? { kind: 'call', callee: call[1], line: found.line, defined: false } : { kind: 'call', callee: call[1], line: found.line, defined: true, definition } }
  }
  const alias = /^([A-Za-z_$][\w$]*)(?:\.[\w$.]+)?\s*(?:\|\||\?\?|or)?/.exec(rhs)
  if (alias && !KEYWORDS.has(alias[1]) && alias[1] !== name && /^[A-Za-z_$][\w$.]*\s*$/.test(rhs.replace(/\s*(?:\|\||\?\?|or)\s*.*$/, ''))) return traceOrigin(texts, alias[1], found.line, depth + 1, trail)
  return { name, lines: trail, origin: { kind: 'literal' } }
}

/** The variables the cited line and the claim have in common: what the claim is about. */
export function claimVariables(message: string, citedLine: string): string[] {
  const words = new Set(message.match(/[A-Za-z_$][\w$]*/g) ?? [])
  const names: string[] = []
  for (const w of citedLine.match(/[A-Za-z_$][\w$]*/g) ?? []) if (words.has(w) && !KEYWORDS.has(w) && w.length >= 3 && !names.includes(w)) names.push(w)
  return names.slice(0, MAX_NAMES)
}

export interface Provenance {
  /** Why the claim cannot be confirmed, or null. */
  block: string | null
  /** Lines the traces followed, so the reads can be shown them. */
  lines: number[]
  /** Local functions the values came from; their definitions belong in the read. */
  localCalls: string[]
}

/**
 * For a claim about the caller's or the input's object: trace each variable it names. A value assigned from a call to a
 * function this file does not define (an import, a method of another class) is not the caller's object, and what that
 * function returns cannot be known from the file, so the claim is not confirmed. A value from a local function is shown
 * with that function's definition.
 */
export function provenanceOf(message: string, texts: readonly string[], line: number, imports: ReadonlySet<string>): Provenance {
  const none: Provenance = { block: null, lines: [], localCalls: [] }
  if (!isMutationClaim(message)) return none
  const out: Provenance = { block: null, lines: [], localCalls: [] }
  for (const name of claimVariables(message, texts[line - 1] ?? '')) {
    const trace = traceOrigin(texts, name, line)
    out.lines.push(...trace.lines)
    if (trace.origin.kind !== 'call') continue
    if (trace.origin.defined) out.localCalls.push(trace.origin.callee.split('.').pop() ?? trace.origin.callee)
    else if (out.block === null) {
      const callee = trace.origin.callee
      const how = imports.has(callee.split('.')[0]) ? 'an imported function' : 'a function this file does not define'
      out.block = `Not confirmed: ${name} is assigned from ${callee}() on line ${trace.origin.line}, ${how}, so it may not be the caller's object.`
    }
  }
  return out
}
