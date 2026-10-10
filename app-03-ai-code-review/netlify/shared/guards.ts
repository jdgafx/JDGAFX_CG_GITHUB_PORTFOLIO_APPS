import { claimVariables } from './provenance'

// A claim that a value "may be undefined, null, None, empty or unset" is false when the code before the cited line already
// guards that value: it reassigns it or leaves the function when it is unset. Found by pattern, with no model. The live
// express res.jsonp L348 claimed the body "may be undefined" while L336-339 read `if (body === undefined) { body = '' }`,
// and the support the second pass quoted was that guard itself.

const LOOKBACK = 40
const AFTER = 3
const LOOKAHEAD = 60

/** A claim about where the unset value goes: it reaches, flows into or is later used by something. */
const FLOWS = /\b(?:flows?|reach(?:es)?|propagat\w+|passed|forwarded|later|then used|is used|ends? up|gets? (?:sent|written|passed))\b/i

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const UNSET_WORD = String.raw`(?:undefined|null|None|nil|empty|unset|not set|missing|falsy)`

/** The variables the claim says are unset: a name the cited line shares with the claim, tied to an unset word by "is", "may be" and the like. */
function unsetVariables(message: string, citedLine: string): { names: string[]; word: string } | null {
  let word = ''
  const names = claimVariables(message, citedLine).filter((name) => {
    const n = esc(name)
    const hit = new RegExp(String.raw`\b${n}\b[^.;:]{0,30}?\b(?:is|are|was|may be|can be|might be|could be|be|being|becomes|stays|remains|equals|===?|yields?|returns?|evaluates? to|gives?|produces?|results? in)\s+(?:still\s+|left\s+)?(${UNSET_WORD})\b|\b(${UNSET_WORD})\s+(?:value\s+of\s+|value\s+for\s+)?${n}\b`, 'i').exec(message)
    if (hit) word = hit[1] ?? hit[2]
    return hit !== null
  })
  return names.length > 0 ? { names, word } : null
}

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
 * For a claim that a value may be unset: a guard before the cited line, as `{ line, text, name }`, or null. A guard is a
 * test of the value against undefined, null or None whose body (the same line or the next few) reassigns it or leaves, or a
 * one-line fallback such as `x = x || y`.
 */
export function guardFor(message: string, texts: readonly string[], line: number): { line: number; text: string; name: string; word: string } | null {
  const claim = unsetVariables(message, texts[line - 1] ?? '')
  if (!claim) return null
  for (const name of claim.names) {
    const reassigns = new RegExp(String.raw`\b${esc(name)}\s*=[^=]`)
    for (let n = line - 1; n >= Math.max(1, line - LOOKBACK); n--) {
      const text = texts[n - 1] ?? ''
      if (fallsBack(text, name)) return { line: n, text: text.trim(), name, word: claim.word }
      if (!testsName(text, name)) continue
      for (let k = n; k <= Math.min(line - 1, n + AFTER); k++) {
        const body = k === n ? text.slice(text.search(testsName(text, name) ? /\S/ : /$/)) : texts[k - 1] ?? ''
        if (reassigns.test(body) || LEAVES.test(body)) return { line: n, text: text.trim(), name, word: claim.word }
      }
    }
  }
  // A value that "flows into" something is also answered by a guard after the cited line, before or around its use.
  if (FLOWS.test(message)) {
    for (const name of claim.names) {
      for (let n = line + 1; n <= Math.min(texts.length, line + LOOKAHEAD); n++) {
        const text = texts[n - 1] ?? ''
        if (testsName(text, name) || fallsBack(text, name)) return { line: n, text: text.trim(), name, word: claim.word }
      }
    }
  }
  return null
}

/** The comment's message, as a not-confirmed reason, when a guard answers it. */
export function guardedClaim(message: string, texts: readonly string[], line: number): string | null {
  const guard = guardFor(message, texts, line)
  if (!guard) return null
  const when = guard.line > line ? 'guarded later, on' : 'already guarded on'
  return `Not confirmed: ${guard.name} is ${when} line ${guard.line} ("${guard.text.slice(0, 60)}"), so the claim that it may be ${guard.word} does not hold here.`
}

/** True when the code quoted as support is itself a test or fallback for the unset value the claim is about. */
export function supportHandlesCondition(message: string, citedLine: string, support: string): string | null {
  const claim = unsetVariables(message, citedLine)
  if (!claim) return null
  const shown = support.replace(/\s+/g, ' ').trim()
  for (const name of claim.names) {
    if (testsName(shown, name) || fallsBack(shown, name)) {
      return `Not confirmed: the code quoted as support ("${shown.slice(0, 60)}") is itself a guard for ${name}, so it does not show that ${name} may be ${claim.word}.`
    }
  }
  return null
}
