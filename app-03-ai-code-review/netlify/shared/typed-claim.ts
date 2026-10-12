// The second pass types each claim it keeps ({ kind, names, lines, quote }), and the code checks that type against the file
// text. Nothing here reads the model's prose: a claim is Not confirmed unless the file bears out what its type says.
import type { ClaimKind } from '../../src/types'
import { collapse, declaredNames, MIN_QUOTE_CHARS, type Doc } from './anchor'
import { importedNames, noneWithoutSource } from './claims'
import { guardedClaim, supportHandlesCondition } from './guards'
import { indentOf, opensScope, scopeExtent } from './scope'

export const CLAIM_KINDS: readonly ClaimKind[] = ['shadows', 'missing-comment', 'type-mismatch', 'unused', 'null-risk', 'other']

export interface TypedClaim {
  kind: ClaimKind
  /** The identifiers or types the claim is about; what they mean depends on the kind. */
  names: string[]
  /** The file lines the claim is about. */
  lines: number[]
  /** Code copied from those lines. */
  quote: string
}

const MAX_NAMES = 4
const MAX_LINES = 6
const MAX_NAME_CHARS = 80
const MAX_QUOTE_CHARS = 200
/** A claim about a missing comment looks this many lines above the cited line. */
const COMMENT_REACH = 3
/** The cited lines may sit this far from the line the comment sits on (a statement can span lines). */
const NEAR = 1

/** The typed claim in a verdict, or null when it is absent or not of the shape: an unknown kind is not defaulted to `other`. */
export function readClaim(value: unknown): TypedClaim | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const kind = CLAIM_KINDS.find((k) => k === v.kind)
  if (!kind || typeof v.quote !== 'string') return null
  const names = Array.isArray(v.names) ? v.names.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map((n) => n.trim().slice(0, MAX_NAME_CHARS)).slice(0, MAX_NAMES) : []
  const lines = Array.isArray(v.lines) ? v.lines.filter((n): n is number => typeof n === 'number' && Number.isInteger(n)).slice(0, MAX_LINES) : []
  return { kind, names, lines, quote: v.quote.slice(0, MAX_QUOTE_CHARS) }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordIn = (text: string, name: string) => new RegExp(String.raw`(?<![\w$])${esc(name)}(?![\w$])`).test(text)
const isIdentifier = (name: string | undefined): name is string => name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name)

// A line that is only a comment, by the comment markers of the languages this page reviews. This reads the file's code.
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*(?:\s|\/|$)|--(?:\s|$)|"""|'''|#(?!\s*(?:include|define|if|ifdef|ifndef|else|elif|endif|undef|pragma)\b)(?!\[))/
const isCommentLine = (line: string) => COMMENT_LINE.test(line)

/** True when `line` declares `name`: an assignment, a short declaration, a definition, a loop variable or (on a signature) a parameter. */
export function declares(line: string, name: string, withParameters = true): boolean {
  if (isCommentLine(line)) return false
  if (declaredNames(line).has(name)) return true
  const walrus = line.indexOf(':=')
  if (walrus > 0 && wordIn(line.slice(0, walrus), name)) return true
  if (new RegExp(String.raw`\b(?:const|let|var)\s*[\[{(]?[^=;]*(?<![\w$])${esc(name)}(?![\w$])[^=;]*=`).test(line)) return true
  if (new RegExp(String.raw`\bfor\s+[^:;]*?(?<![\w$])${esc(name)}(?![\w$])[^:;]*?\bin\b`).test(line)) return true
  if (withParameters && opensScope(line)) {
    const open = line.indexOf('(')
    if (open >= 0 && wordIn(line.slice(open), name)) return true
  }
  return false
}

const codeLines = (doc: Doc, from: number, to: number): Array<[number, string]> => {
  const out: Array<[number, string]> = []
  for (let n = Math.max(1, from); n <= Math.min(to, doc.texts.length); n += 1) if (!isCommentLine(doc.texts[n - 1])) out.push([n, doc.texts[n - 1]])
  return out
}

/** The lines the claim cites must be real, and one of them must be where the comment sits; its quote must be verbatim there. */
function citedLines(claim: TypedClaim, doc: Doc, at: number): string | null {
  const count = doc.texts.length
  if (claim.lines.length === 0) return 'Not confirmed: the second pass named no line for its claim.'
  const outside = claim.lines.find((n) => n < 1 || n > count)
  if (outside !== undefined) return `Not confirmed: the second pass's claim is about line ${outside}, which is outside the file.`
  if (!claim.lines.some((n) => Math.abs(n - at) <= NEAR)) {
    return `Not confirmed: the second pass's claim is about line ${claim.lines.join(', ')}, but the comment sits on line ${at}.`
  }
  const quote = collapse(claim.quote)
  // As written, without a copied line-number prefix, without a diff + or - (the reads see a signed listing; the texts have no sign).
  const unnumbered = quote.replace(/^\d+\s*\|\s?/, '')
  const forms = [...new Set([quote, unnumbered, unnumbered.replace(/^[+-]\s?/, '')].map(collapse))].filter((f) => f.length >= MIN_QUOTE_CHARS)
  const cited = collapse([...claim.lines].sort((a, b) => a - b).map((n) => doc.texts[n - 1]).join(' '))
  if (!forms.some((f) => cited.includes(f))) {
    return `Not confirmed: the second pass quoted "${quote.slice(0, 80)}" for its claim, which is not on line ${claim.lines.join(', ')}.`
  }
  return null
}

/**
 * Shadows: the name the cited line declares must also be an import, or declared in an enclosing block, parameter list or at top
 * level. The claim may cite the outer declaration as well as the shadowing one (the live mux.go claim cited both): the shadowing
 * line is the cited line that declares the name nearest the comment, and every other line is looked at as a possible outer one.
 */
function shadows(claim: TypedClaim, doc: Doc, at: number): string | null {
  const name = claim.names[0]
  if (!isIdentifier(name)) return 'Not confirmed: the second pass named no identifier that the cited line declares.'
  const declaring = claim.lines.filter((n) => declares(doc.texts[n - 1], name))
  if (declaring.length === 0) return `Not confirmed: ${name} is not declared on the cited line, so nothing is shadowed there.`
  if (importedNames(doc.texts, 1).has(name)) return null
  const first = declaring.reduce((best, n) => (Math.abs(n - at) < Math.abs(best - at) || (Math.abs(n - at) === Math.abs(best - at) && n > best) ? n : best))
  const own = indentOf(doc.texts[first - 1])
  const cited = new Set(claim.lines)
  for (let n = 1; n <= doc.texts.length; n += 1) {
    // A cited line in the same block as the shadowing one redeclares the name; it does not hide behind it.
    if (n === first || (cited.has(n) && indentOf(doc.texts[n - 1]) >= own)) continue
    if (indentOf(doc.texts[n - 1]) === 0 && declares(doc.texts[n - 1], name, false)) return null
  }
  // A line outside the cited one is an outer declaration when no line between it and the cited one is indented less than it:
  // a block that has closed hides what it declared.
  let reach = own
  for (let n = first - 1; n >= 1; n -= 1) {
    const text = doc.texts[n - 1]
    if (text.trim() === '' || isCommentLine(text)) continue
    const indent = indentOf(text)
    if (indent > reach) continue
    if (indent < own && declares(text, name)) return null
    reach = Math.min(reach, indent)
  }
  return `Not confirmed: ${name} is declared on the cited line, but the file has no import and no outer declaration of ${name} for it to shadow.`
}

/** Missing comment: none of the three lines above the cited line is a comment. */
function missingComment(claim: TypedClaim, doc: Doc): string | null {
  const first = Math.min(...claim.lines)
  for (let n = first - 1; n >= Math.max(1, first - COMMENT_REACH); n -= 1) {
    if (isCommentLine(doc.texts[n - 1])) return `Not confirmed: line ${n} is a comment ("${doc.texts[n - 1].trim().slice(0, 60)}"), so the code is not left without one.`
  }
  return null
}

const compact = (text: string) => text.replace(/\s+/g, '')
const typeBase = (name: string) => /^[A-Za-z_$][\w$]*/.exec(name.replace(/^[*&[\]\s]+/, ''))?.[0] ?? null

/** Type mismatch: two types, each named in the file's code, and each defined in this file rather than only imported. */
function typeMismatch(claim: TypedClaim, doc: Doc): string | null {
  if (claim.names.length < 2) return 'Not confirmed: a type mismatch needs the two types compared, and the second pass named fewer.'
  const code = compact(codeLines(doc, 1, doc.texts.length).map(([, t]) => t).join('\n'))
  const imported = importedNames(doc.texts, 1)
  for (const name of claim.names) {
    if (!code.includes(compact(name))) return `Not confirmed: the type ${name} does not appear in the file.`
    const base = typeBase(name)
    if (base === null || !imported.has(base)) continue
    const defined = codeLines(doc, 1, doc.texts.length).some(([, t]) => new RegExp(String.raw`^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:type|interface|class|struct|enum|trait)\s+${esc(base)}(?![\w$])`).test(t))
    if (!defined) return `Not confirmed: ${base} is imported and defined in another file, so a mismatch involving it cannot be confirmed from this file.`
  }
  return null
}

/** Unused: the name appears on the cited line and nowhere else in its scope (the whole file for an import, a top-level name or a function's own name). */
function unused(claim: TypedClaim, doc: Doc): string | null {
  const name = claim.names[0]
  if (!isIdentifier(name)) return 'Not confirmed: the second pass named no identifier for its claim that something is unused.'
  const first = Math.min(...claim.lines)
  if (!claim.lines.some((n) => wordIn(doc.texts[n - 1], name))) return `Not confirmed: ${name} is not on the cited line.`
  const extent = opensScope(doc.texts[first - 1]) ? null : scopeExtent(doc.texts, first)
  const [from, to] = extent ?? [1, doc.texts.length]
  const cited = new Set(claim.lines)
  const use = codeLines(doc, from, to).find(([n, text]) => !cited.has(n) && wordIn(text, name))
  return use ? `Not confirmed: ${name} is used again on line ${use[0]} ("${use[1].trim().slice(0, 60)}"), so it is not unused.` : null
}

/** Null risk: the variable is on the cited line, no guard before it handles the unset case, and the support shows where the None comes from. */
function nullRisk(claim: TypedClaim, doc: Doc, support: string): string | null {
  const name = claim.names[0]
  if (!isIdentifier(name)) return 'Not confirmed: the second pass named no variable for its claim that a value may be unset.'
  const first = Math.min(...claim.lines)
  if (!claim.lines.some((n) => wordIn(doc.texts[n - 1], name))) return `Not confirmed: ${name} is not on the cited line.`
  return guardedClaim(name, doc.texts, first) ?? supportHandlesCondition(name, support) ?? noneWithoutSource(support)
}

/**
 * Why a typed claim is not confirmed by the file, or null when it is. `at` is the line the comment sits on; `support` is the
 * code the second pass gave as making the claim true. A claim of kind `other` has no check of its own beyond its quote.
 */
export function checkClaim(claim: TypedClaim, doc: Doc, at: number, support: string): string | null {
  const cited = citedLines(claim, doc, at)
  if (cited !== null) return cited
  switch (claim.kind) {
    case 'shadows':
      return shadows(claim, doc, at)
    case 'missing-comment':
      return missingComment(claim, doc)
    case 'type-mismatch':
      return typeMismatch(claim, doc)
    case 'unused':
      return unused(claim, doc)
    case 'null-risk':
      return nullRisk(claim, doc, support)
    case 'other':
      return null
  }
}
