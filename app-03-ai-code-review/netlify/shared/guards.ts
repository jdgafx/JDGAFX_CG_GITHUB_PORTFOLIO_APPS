// A claim typed as null-risk ("this value may be undefined, null, None or unset") is false when the code before the cited
// line already guards that value: it reassigns it or leaves the function when it is unset. Found by pattern in the file's
// code, for the variable the typed claim names. The live express res.jsonp L348 claimed the body "may be undefined" while
// L336-339 read `if (body === undefined) { body = '' }`, and the support the second pass quoted was that guard itself.

const LOOKBACK = 40
const AFTER = 3

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A line that tests `name` against an unset value, in the shapes JavaScript, TypeScript, Python and Go use. */
function testsName(line: string, name: string): boolean {
  const n = esc(name)
  return new RegExp(
    String.raw`\b${n}\s*(?:===?|!==?)\s*(?:undefined|null|void 0|nil|None)\b|\b(?:undefined|null|nil)\s*(?:===?|!==?)\s*${n}\b|\b${n}\s+is(?:\s+not)?\s+None\b|\bif\s*\(?\s*!\s*${n}\b|\bif\s+not\s+${n}\b|typeof\s+${n}\s*(?:===?|!==?)\s*['"]undefined['"]|\bif\s*\(?\s*${n}\s*\)?\s*[{:]?\s*$`,
  ).test(line)
}

/** A line that gives `name` a fallback in one statement. */
function fallsBack(line: string, name: string): boolean {
  const n = esc(name)
  return new RegExp(String.raw`\b${n}\s*(?:\|\||\?\?)=|\b${n}\s*=\s*${n}\s*(?:\|\||\?\?|\?)|\b${n}\s*=\s*${n}\s+(?:or|if)\b`).test(line)
}

const LEAVES = /\b(?:return|throw|raise|continue|break)\b/

/**
 * For a claim that `name` may be unset: a guard before the cited line, as `{ line, text, name }`, or null. A guard is a
 * test of the value against undefined, null or None whose body (the same line or the next few) reassigns it or leaves, or a
 * one-line fallback such as `x = x || y`.
 */
export function guardFor(name: string, texts: readonly string[], line: number): { line: number; text: string; name: string } | null {
  const reassigns = new RegExp(String.raw`\b${esc(name)}\s*=[^=]`)
  for (let n = line - 1; n >= Math.max(1, line - LOOKBACK); n--) {
    const text = texts[n - 1] ?? ''
    if (fallsBack(text, name)) return { line: n, text: text.trim(), name }
    if (!testsName(text, name)) continue
    for (let k = n; k <= Math.min(line - 1, n + AFTER); k++) {
      const body = k === n ? text.slice(text.search(testsName(text, name) ? /\S/ : /$/)) : texts[k - 1] ?? ''
      if (reassigns.test(body) || LEAVES.test(body)) return { line: n, text: text.trim(), name }
    }
  }
  return null
}

/** The typed claim's variable, as a not-confirmed reason, when a guard answers it. */
export function guardedClaim(name: string, texts: readonly string[], line: number): string | null {
  const guard = guardFor(name, texts, line)
  if (!guard) return null
  return `Not confirmed: ${guard.name} is already guarded on line ${guard.line} ("${guard.text.slice(0, 60)}"), so the claim that it may be unset does not hold here.`
}

/** True when the code quoted as support is itself a test or fallback for the unset variable the claim is about. */
export function supportHandlesCondition(name: string, support: string): string | null {
  const shown = support.replace(/\s+/g, ' ').trim()
  if (testsName(shown, name) || fallsBack(shown, name)) {
    return `Not confirmed: the code quoted as support ("${shown.slice(0, 60)}") is itself a guard for ${name}, so it does not show that ${name} may be unset.`
  }
  return null
}
