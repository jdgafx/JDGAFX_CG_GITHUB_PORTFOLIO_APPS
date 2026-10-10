// Deterministic checks on what a comment claims, before the second pass is trusted about it. A claim about how another
// library, a link target or a language version behaves cannot be confirmed from one file; a claim that something is never
// closed is false when the scope closes it. Neither needs a model.
import { ABOUT_A_NAME } from './anchor'
import { enclosingScope } from './scope'

/** Names this file imports or requires, from Python, JavaScript, TypeScript and Go import forms. Best effort. */
export function importedNames(texts: readonly string[]): Set<string> {
  const names = new Set<string>()
  const add = (raw: string) => {
    const word = raw.trim().split(/\s+as\s+/).pop()?.replace(/[(){}*]/g, '').trim() ?? ''
    if (/^[A-Za-z_$][\w$]*$/.test(word) && word.length >= 3) names.add(word)
  }
  let inGoImports = false
  // The whole file: Python imports inside a function (click's `from glob import glob`) and dynamic imports count too.
  texts.forEach((line) => {
    let m: RegExpExecArray | null
    if ((m = /^\s*from\s+[\w.]+\s+import\s+(.+)$/.exec(line))) m[1].split(',').forEach(add)
    else if ((m = /^\s*import\s+([\w.\s,]+?)\s*$/.exec(line)) && !/\bfrom\b/.test(line)) m[1].split(',').forEach((p) => add(p.includes(' as ') ? p : p.trim().split('.')[0]))
    if ((m = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(/.exec(line))) add(m[1])
    if ((m = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?(?:require|import)\(/.exec(line))) m[1].split(',').forEach(add)
    if ((m = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import\(/.exec(line))) add(m[1])
    if ((m = /^\s*import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s*(?:,|\s+from)/.exec(line))) add(m[1])
    if ((m = /^\s*import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from/.exec(line))) m[1].split(',').forEach(add)
    if (/^\s*import\s*\(\s*$/.test(line)) inGoImports = true
    else if (inGoImports && /^\s*\)\s*$/.test(line)) inGoImports = false
    const go = inGoImports ? /^\s*(?:(\w+)\s+)?"([\w./-]+)"\s*$/.exec(line) : /^\s*import\s+(?:(\w+)\s+)?"([\w./-]+)"\s*$/.exec(line)
    if (go) add(go[1] ?? go[2].split('/').pop() ?? '')
  })
  return names
}

/** Imported names that are also plain words in a message; they would match any sentence, so they never count on their own. */
const PLAIN_WORDS = new Set(['path', 'http', 'type', 'types', 'errors', 'error', 'context', 'time', 'string', 'strings', 'file', 'files', 'url', 'text', 'data', 'name', 'join', 'key', 'sync', 'list', 'sort', 'bytes', 'math', 'json', 'copy', 'sys', 'log', 'flag', 'fmt', 'io', 'os'])

const BEHAVIOUR = /\b(?:passe[sd](?:\s+on)?(?:\s+unchanged)?\s+to|handed\s+to|forwarded?\s+to|forwards?|calls?|delegates?\s+to|mutates?|modif(?:y|ies)|shares?|aliases|does not|doesn't|do not|will not|never|throws?|raises?|returns?|treats?|interprets?|parses?|converts?|encodes?|decodes?|handles?|accepts?|rejects?|ignores?|swallows?|fails?|behaves?|resolves?|supports?|requires?)\b/i
const LINK_CLAIM = /\b(?:resolves?|resolve to|exists?|nonexistent|404|broken|disagrees?|does not match|different (?:location|path)|points? to)\b/i
/** A failure that is only gestured at: no path to it is named, so there is nothing to confirm. */
const HEDGE = /\b(?:unexpected (?:path|state|case|situation)|in theory|theoretical(?:ly)?|hypothetical(?:ly)?|some other path|unknown path|for some reason)\b/i

/** A failure that depends on the process environment (an unset variable, a missing home directory), which a file cannot show. */
const ENVIRONMENT = /\$[A-Z][A-Z_]{1,}|\b(?:environment variables?|env vars?|HOME)\b|\bunset\b/

const VERSION_CLAIM = /\bPython\s*\d|\bNode(?:\.js)?\s*\d|\bGo\s*1\.\d|\bJava\s*\d|\bversions?\b|\bsupported (?:python|node|go)\b|\bsince\s+(?:python|node|v?\d)/i

/**
 * Why a claim cannot be confirmed from this file alone, or null. Three kinds: it describes how an imported or required name
 * behaves (the live express `send` treating `?` as a query), it is about where a link or URL points (the redux link to
 * `/reselect/`), or it rests on a language or library version. A message that is about a name itself (shadowing, renaming)
 * is not about behaviour.
 */
export function unconfirmable(message: string, citedCode: string, imports: ReadonlySet<string>): string | null {
  if (ABOUT_A_NAME.test(message)) return null
  for (const sentence of message.split(/(?<=[.;])\s+/)) {
    const structural = (name: string) => new RegExp(String.raw`(?<![\w$.])${name.replace(/\$/g, '\\$')}\.[\w$]+\s*\(`).test(sentence)
    if (!BEHAVIOUR.test(sentence) && ![...imports].some((n) => !PLAIN_WORDS.has(n.toLowerCase()) && structural(n))) continue
    for (const name of imports) {
      if (PLAIN_WORDS.has(name.toLowerCase())) continue
      if (new RegExp(String.raw`(?<![\w$.])${name.replace(/\$/g, '\\$')}(?![\w$])`).test(sentence)) {
        return `Not confirmed: the claim rests on how ${name} behaves, and ${name} is not defined in this file.`
      }
    }
  }
  if (/\]\(|https?:\/\//.test(citedCode + message) && /\b(?:link|url|href|target)\b/i.test(message) && LINK_CLAIM.test(message)) {
    return 'Not confirmed: the claim rests on where a link points, which the diff does not show.'
  }
  if (ENVIRONMENT.test(message) && /\b(?:raises?|throws?|fails?|crash(?:es)?|uncaught)\b/i.test(message)) {
    return 'Not confirmed: the claim rests on the process environment (an unset variable or missing home directory), which the file does not show.'
  }
  const hedge = HEDGE.exec(message)
  if (hedge) return `Not confirmed: the claim names no path to the failure ("${hedge[0]}"), so there is nothing to check it against.`
  if (VERSION_CLAIM.test(message)) return 'Not confirmed: the claim rests on a language or library version, which the file does not show.'
  return null
}

const MISSING: ReadonlyArray<{ claim: RegExp; call: RegExp; what: string }> = [
  // A handle opened and closed in one expression (`open(f, mode).close()`) cannot leak, whatever the comment says about it.
  { claim: /context manager|never (?:be )?closed|not (?:be )?closed|refcount|garbage collection|\bleaks?\b/i, call: /\bopen\s*\([^)]*\)\s*\.close\s*\(/, what: 'close' },
  {
    claim: /\bnever (?:be )?closed\b|\bnot (?:be )?closed\b|without (?:a context manager|closing|being closed)|\bno (?:context manager|close call)\b|relies? on (?:garbage collection|(?:the )?(?:temporary object'?s? )?refcount)|never calls? close|\bleaks? the (?:file|handle)\b/i,
    call: /\.close\s*\(|\bclose\s*\(|\bwith\s+open\b/,
    what: 'close',
  },
  { claim: /\bnever (?:be )?(?:released|unlocked)\b|\bnot (?:be )?(?:released|unlocked)\b/i, call: /\.(?:release|unlock|Unlock)\s*\(|\bdefer\b.*Unlock/, what: 'release' },
  { claim: /\bnever (?:be )?awaited\b|\bnot (?:be )?awaited\b/i, call: /\bawait\b/, what: 'await' },
]

/** A comment that says a call is missing, when the call is in the scope of the line it cites: the line and its text, or null. */
export function contradictedByScope(message: string, suggestion: string, texts: readonly string[], line: number, skip?: (n: number) => boolean): { what: string; at: number; text: string } | null {
  const claim = `${message} ${suggestion}`
  const scope = enclosingScope(texts, line)
  for (const rule of MISSING) {
    if (!rule.claim.test(message)) continue
    for (let n = scope.from; n <= scope.to; n += 1) {
      if (skip?.(n)) continue
      if (rule.call.test(texts[n - 1]) && !rule.claim.test(texts[n - 1]) && claim.length > 0) return { what: rule.what, at: n, text: texts[n - 1].trim().slice(0, 80) }
    }
  }
  return null
}

const NONE_CLAIM = /\b(?:is|are|still|may be|can be|can remain|remains?|stays?|be)\s+(?:still\s+)?(?:None|null|undefined|nil)\b|\bNone\b.*\braises?\b|\bnull\b.*\b(?:throws?|raises?)\b/
const NONE_SOURCE = /\b(?:None|null|undefined|nil|Optional|optional)\b|\?:|\bor None\b/

/**
 * A claim that a value is None or null must be backed by code that shows where the None comes from: an assignment, a
 * return, an Optional type or default. Backing that never mentions one (the live click L191: support `self.open()` or
 * `self._f = rv`) shows nothing about None, so the claim is not confirmed.
 */
export function noneWithoutSource(message: string, support: string): string | null {
  if (!NONE_CLAIM.test(message) || NONE_SOURCE.test(support)) return null
  return 'Not confirmed: the claim is that a value is None or null, but the code quoted for it does not show where a None comes from.'
}
