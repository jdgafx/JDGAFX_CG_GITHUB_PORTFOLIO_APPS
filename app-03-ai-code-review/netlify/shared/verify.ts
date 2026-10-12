import type { ClaimKind, Decider, ReviewComment, Verdict } from '../../src/types'
import { importedNames, unconfirmable } from './claims'
import { flowsIntoExternal, provenanceOf } from './provenance'
import { seenLines } from './scope'
import { codeNames, collapse, MIN_QUOTE_CHARS, QUOTE_WINDOW, type Doc } from './anchor'
import { parseJsonObject, type Candidate, type CheckedDrop } from './review'
import { checkClaim, declares, readClaim, type TypedClaim } from './typed-claim'
import type { DiffUnit } from './diff'

/** A moved comment may travel at most this far from where the checks left it. Further is not a correction. */
export const MAX_MOVE = 25
/** The quoted code may sit this many lines from the line the verifier names (a statement can span lines). */
const KEEP_WINDOW = 1
const MAX_REASON_CHARS = 300
const MAX_EVIDENCE_CHARS = 160

export { buildRefutePrompt, buildVerifyPrompt, buildVerifyUser } from './verify-prompt'

export interface RawVerdict {
  id: number
  verdict: string
  line: number | null
  evidence: string
  /** Code that makes the claim true, quoted from anywhere in the file. */
  support: string
  reason: string
  /** The statement in the comment's message that the code shows is false, or empty when every statement in it is true. */
  contradicted?: string
  /** What the comment claims, typed so the code can check it against the file. Null when the reply gave none or gave a malformed one. */
  claim: TypedClaim | null
}

/** The verdict list from a reply: an object with a verdicts array, or the bare array the model sometimes returns. */
function verdictList(text: string): unknown[] | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const value: unknown = JSON.parse(cleaned)
    if (Array.isArray(value)) return value
  } catch {
    // Not a bare array: fall through to an object with a verdicts array, possibly inside prose.
  }
  const object = parseJsonObject(cleaned)
  return object && Array.isArray(object.verdicts) ? object.verdicts : null
}

/** Reads the verdicts in a reply. Returns null when the reply holds no list of verdicts at all. */
export function readVerdicts(text: string): Map<number, RawVerdict> | null {
  const list = verdictList(text)
  if (!list) return null
  const byId = new Map<number, RawVerdict>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const v = item as Record<string, unknown>
    if (typeof v.id !== 'number' || !Number.isInteger(v.id) || byId.has(v.id)) continue
    byId.set(v.id, {
      id: v.id,
      verdict: typeof v.verdict === 'string' ? v.verdict.trim().toLowerCase() : '',
      line: typeof v.line === 'number' && Number.isInteger(v.line) ? v.line : null,
      evidence: typeof v.evidence === 'string' ? v.evidence.slice(0, MAX_EVIDENCE_CHARS * 2) : '',
      support: typeof v.support === 'string' ? v.support.slice(0, MAX_EVIDENCE_CHARS * 2) : '',
      reason: typeof v.reason === 'string' ? collapse(v.reason).slice(0, MAX_REASON_CHARS) : '',
      contradicted: typeof v.contradicted === 'string' ? collapse(v.contradicted).slice(0, MAX_REASON_CHARS) : '',
      claim: readClaim(v.claim),
    })
  }
  return byId
}

/** The forms a quoted fragment may take: as written, without a copied line-number prefix, without a diff + or -. */
function evidenceForms(evidence: string): string[] {
  const bare = evidence.trim().replace(/^(['"`])(.*)\1$/s, '$2')
  const noNumber = bare.replace(/^\d+\s*\|\s?/, '')
  const noSign = noNumber.replace(/^[+-]\s?/, '')
  return [...new Set([bare, noNumber, noSign].map(collapse))].filter((f) => f.length >= MIN_QUOTE_CHARS)
}

/** The line within `window` of `near` (nearest first, later on a tie) whose code holds the evidence, or null. */
export function findEvidence(doc: Doc, evidence: string, near: number, window: number): number | null {
  const forms = evidenceForms(evidence)
  if (forms.length === 0) return null
  const holds = (n: number) => n >= 1 && n <= doc.texts.length && forms.some((f) => collapse(doc.texts[n - 1]).includes(f))
  for (let distance = 0; distance <= window; distance += 1) {
    for (const n of distance === 0 ? [near] : [near + distance, near - distance]) if (holds(n)) return n
  }
  return null
}

/** True when the evidence is in the code somewhere. Used for a drop, whose proof may be far from the comment. */
const evidenceAnywhere = (doc: Doc, evidence: string): number | null => findEvidence(doc, evidence, 1, doc.texts.length)

/**
 * In a pull request the second pass cites positions in the numbered diff ("Line 9 declares ..."). A reader sees file lines,
 * so each cited position becomes `path:line` (new side, or old side for a removed line). A position that is not a code line
 * of a file (a header) becomes the file name, and one that cannot be placed is left out rather than shown wrong.
 */
export function translateLines(reason: string, locate: (line: number) => Located): string {
  const name = (n: number): string | null => {
    const w = locate(n).where
    return w ? (w.line === 0 ? w.file : `${w.file}:${w.line}`) : null
  }
  const range = (a: number, b: number): string | null => {
    const from = locate(a).where
    const to = locate(b).where
    if (!from || !to) return null
    if (from.file === to.file && from.line > 0 && to.line > 0) return `${from.file}:${from.line}-${to.line}`
    return `${name(a)} to ${name(b)}`
  }
  return reason
    .replace(/\blines?\s+(\d+)\s*(?:-|\u2013|to)\s*(\d+)/gi, (m, a: string, b: string) => range(Number(a), Number(b)) ?? m)
    .replace(/\blines?\s+(\d+)(?:\s+and\s+(\d+))?/gi, (m, a: string, b: string | undefined) => {
      if (m.includes(':')) return m
      const first = name(Number(a))
      if (first === null) return m
      return b === undefined ? first : `${first} and ${name(Number(b)) ?? b}`
    })
    .replace(/\b(at|on)\s+(\d{1,5})(?:\s+and\s+(\d{1,5}))?(?!\d)(?!\s*(?:hex|char|byte|bit|ms\b|s\b|%|px|chars|characters|digits))/gi, (m, w: string, a: string, b: string | undefined) => {
      const first = name(Number(a))
      if (first === null) return m
      return b === undefined ? `${w} ${first}` : `${w} ${first} and ${name(Number(b)) ?? b}`
    })
}

export interface Settled {
  line: number
  verdict: Verdict
  decidedBy: Decider
  reason: string
  evidence: string | null
  /** The code that makes the claim true, and the numbered line it was found on. */
  support: string | null
  supportAt: number | null
  /** The kind of claim the second pass typed, for a kept or moved comment. `other` was confirmed by its quote alone. */
  claimKind: ClaimKind | null
}

const importCache = new WeakMap<Doc, Set<string>>()
const importsOf = (doc: Doc): Set<string> => {
  let names = importCache.get(doc)
  if (!names) importCache.set(doc, (names = importedNames(doc.texts)))
  return names
}

/** Words a reason uses when it admits the claim is not backed by the code. */
const ADMISSION = /\bunsupported by (?:the )?code\b|\bnot (?:directly )?(?:shown|supported|demonstrated|established|evidenced)(?: (?:by|in) (?:the |this )?(?:code|file|diff))?|\bcannot be (?:confirmed|verified|shown|established)\b|\bno (?:code|evidence) (?:shows|supports|in the (?:file|code))\b|\bonly speculat\w+|\bspeculative\b/i

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

function unconfirmed(candidate: Candidate, reason: string): Settled {
  return { line: candidate.line, verdict: 'unverified', decidedBy: 'none', reason, evidence: null, support: null, supportAt: null, claimKind: null }
}

/**
 * Turns one verdict into a settled comment, re-checking it against the code. A verdict is kept only when the code
 * it quotes is really on the line it names; otherwise the comment stays on screen as unverified, never as checked.
 */
export function settle(candidate: Candidate, raw: RawVerdict | undefined, doc: Doc): Settled {
  if (!raw) return unconfirmed(candidate, 'The second pass gave no verdict for this comment.')
  const reason = raw.reason || 'The second pass gave no reason.'
  const shown = clip(collapse(raw.evidence), 80)
  const lineCount = doc.texts.length
  const target = raw.line ?? candidate.line

  if (raw.verdict === 'keep' || raw.verdict === 'move') {
    // A kept comment is held to its typed claim. A reply with none, or a malformed one, is not read as a plain claim.
    const claim = raw.claim
    if (claim === null) return unconfirmed(candidate, 'Not confirmed: the second pass did not give a typed claim for this comment.')
    // Both name the line the comment belongs on. Whether it counts as moved follows from where it ends up.
    if (target < 1 || target > lineCount || Math.abs(target - candidate.line) > MAX_MOVE) {
      return unconfirmed(candidate, `Not confirmed: the second pass named line ${target}, which is outside what a move may reach.`)
    }
    if (doc.why[target - 1] !== null) {
      return unconfirmed(candidate, `Not confirmed: the second pass named line ${target}, which cannot carry a comment.`)
    }
    // A comment that quotes code sits where that code is. A move away from the quote's own line, to a line with no
    // such quote near it, is not a correction: the first pass had the line right and the second pass lost it.
    if (target !== candidate.line && candidate.quote.length >= MIN_QUOTE_CHARS) {
      const home = collapse(doc.texts[candidate.line - 1]).includes(collapse(candidate.quote))
      if (home && findEvidence(doc, candidate.quote, target, QUOTE_WINDOW) === null) {
        return unconfirmed(candidate, `Not confirmed: the second pass moved it to line ${target}, away from the code it quotes on line ${candidate.line}.`)
      }
    }
    // A move keeps the comment's subject: it never leaves the line that declares a name the message is about (the live
    // shadowing comment moved from `path := req.URL.Path` to a later use), and never crosses from an added line to a removed one.
    // Moving back to the line the first pass cited is always allowed: it undoes a wrong move by the checks.
    if (doc.files && doc.files[target - 1] !== doc.files[candidate.line - 1]) {
      return unconfirmed(candidate, `Not confirmed: the second pass moved it to line ${target}, which is in another file.`)
    }
    if (target !== candidate.line && target !== candidate.fromLine) {
      const subject = claim.kind === 'shadows' ? claim.names[0] : undefined
      if (subject !== undefined && declares(doc.texts[candidate.line - 1], subject) && !declares(doc.texts[target - 1], subject)) {
        return unconfirmed(candidate, `Not confirmed: the second pass moved it to line ${target}, away from the line that declares ${subject}, which the comment is about.`)
      }
      if (doc.sides && doc.sides[target - 1] !== doc.sides[candidate.line - 1]) {
        return unconfirmed(candidate, `Not confirmed: the second pass moved it to line ${target}, to the other side of the change.`)
      }
      // A move lands where the code the message talks about is. A target that holds none of those names is a different
      // subject (the live express JSONP Warning on L334, moved onto an unrelated comment line).
      const names = codeNames(candidate.message)
      if (names.length > 0 && !names.some((name) => doc.texts[target - 1].includes(name))) {
        return unconfirmed(candidate, `Not confirmed: the second pass moved it to line ${target}, which holds none of the code the comment names (${names.slice(0, 2).join(', ')}).`)
      }
    }
    const at = findEvidence(doc, raw.evidence, target, KEEP_WINDOW)
    if (at === null || doc.why[at - 1] !== null) {
      return unconfirmed(candidate, `Not confirmed: the second pass quoted "${shown}", which is not on line ${target}.`)
    }
    // The claim is held to the file by its type, and its lines must be where the comment sits (the live SHA-1 comment sat on
    // line 200 while its reason said "cnonce at line 205"; the live aliasing comment sat on the signature of walk).
    const claimIssue = checkClaim(claim, doc, at, raw.support)
    if (claimIssue !== null) return unconfirmed(candidate, claimIssue)
    // A claim about how another library behaves, where a link points or which version is supported cannot be confirmed from
    // this file: its support would have to be a definition of that name here, and an import has none.
    const about = claim.kind === 'shadows'
    const outside = unconfirmable(candidate.message, doc.texts[at - 1], importsOf(doc), about)
    if (outside !== null) return unconfirmed(candidate, outside)
    // The reason is held to the same rule: a reason that names an imported function's behaviour caps the comment.
    const reasonOutside = unconfirmable(reason, doc.texts[at - 1], importsOf(doc), about)
    if (reasonOutside !== null) return unconfirmed(candidate, reasonOutside)
    // A claim about the caller's object is only as good as where that object came from.
    const origin = provenanceOf(candidate.message, doc.texts, at, importsOf(doc))
    if (origin.block !== null) return unconfirmed(candidate, origin.block)
    // A consequence that happens inside an imported function the value is handed to cannot be confirmed from this file.
    const flow = flowsIntoExternal(candidate.message, doc.texts, at, importsOf(doc)) ?? flowsIntoExternal(reason, doc.texts, at, importsOf(doc))
    if (flow !== null) return unconfirmed(candidate, flow)
    // Two quotes, both in the file: the cited line, and the code that makes the claim true. A claim the second pass cannot
    // point at code for is not confirmed, however real the cited line is.
    const supportShown = clip(collapse(raw.support), 80)
    if (collapse(raw.support).length < MIN_QUOTE_CHARS) {
      return unconfirmed(candidate, 'Not confirmed: the second pass could not quote the code that shows the claim is true.')
    }
    // A comment is kept whole or not at all: a statement in it that the read itself found false is not confirmed, however true the rest is.
    if (raw.contradicted) return unconfirmed(candidate, `Not confirmed: the second pass found a statement in the comment that the code contradicts ("${clip(raw.contradicted, 80)}").`)
    // A reason that admits the code does not show the claim is not a confirmation, whatever verdict came with it (live auth.py L114).
    const admitted = ADMISSION.exec(reason)
    if (admitted) return unconfirmed(candidate, `Not confirmed: the second pass's own reason says the code does not show it ("${admitted[0]}").`)
    const supportAt = findEvidence(doc, raw.support, at, doc.texts.length)
    if (supportAt === null) {
      return unconfirmed(candidate, `Not confirmed: the second pass gave "${supportShown}" as the code that shows the claim, which is not in the code.`)
    }
    // A warning or error stands only when the code behind it is inside what the reads were shown: the scope, the lines its
    // variables came from, and the definitions of what it names. Info comments are unchanged.
    if (candidate.severity !== 'info') {
      const seen = seenLines(doc.texts, candidate.line, `${candidate.message} ${candidate.suggestion} ${candidate.quote}`)
      if (!seen.has(at) || !seen.has(supportAt)) {
        return unconfirmed(candidate, `Not confirmed: the code behind this ${candidate.severity === 'critical' ? 'error' : 'warning'} (line ${seen.has(at) ? supportAt : at}) is outside the code the reads were shown.`)
      }
    }
    return { line: at, verdict: at === candidate.fromLine ? 'kept' : 'moved', decidedBy: 'verifier', reason, evidence: shown, support: supportShown, supportAt, claimKind: claim.kind }
  }

  if (raw.verdict === 'unsure') {
    return unconfirmed(candidate, `Cannot be confirmed from the code: ${reason}`)
  }

  if (raw.verdict === 'drop') {
    const at = evidenceAnywhere(doc, raw.evidence)
    if (at === null) {
      return unconfirmed(candidate, `Not confirmed: the second pass wanted to drop it and quoted "${shown}", which is not in the code.`)
    }
    return { line: candidate.line, verdict: 'dropped', decidedBy: 'verifier', reason, evidence: shown, support: null, supportAt: null, claimKind: null }
  }

  return unconfirmed(candidate, 'The second pass gave a verdict this page does not recognise.')
}

export interface Located {
  text: string
  where: ReviewComment['where']
}

/** Builds the comment list: every first-pass comment appears once, kept, moved, dropped or unverified. */
/** The text of a reason, cut for quoting inside another reason. */
const quoted = (reason: string) => (reason.length > 110 ? `${reason.slice(0, 109)}…` : reason)

/** What the adversarial read found for one comment, after its quote was looked for in the code. */
export interface Rebuttal {
  state: 'stands' | 'refuted' | 'unsure'
  reason: string
  /** The code it quoted, when that code is really in the file. */
  quote: string | null
}

/**
 * Checks the adversarial read's answer. A "refuted" or "stands" answer must quote code that is in the file; an answer whose
 * quote is not there counts as "unsure", so an invented rebuttal and an invented "all clear" both leave the comment unconfirmed.
 */
export function settleRebuttal(raw: RawVerdict | undefined, doc: Doc): Rebuttal {
  if (!raw) return { state: 'unsure', reason: 'The second read gave no answer for this comment.', quote: null }
  const word = raw.verdict
  if (word !== 'refuted' && word !== 'stands') return { state: 'unsure', reason: raw.reason || 'The second read could not judge it from the code.', quote: null }
  const at = evidenceAnywhere(doc, raw.evidence)
  if (at === null) return { state: 'unsure', reason: `The second read quoted "${clip(collapse(raw.evidence), 60)}", which is not in the code.`, quote: null }
  return { state: word, reason: raw.reason, quote: clip(collapse(raw.evidence), 80) }
}

/**
 * The first read's verdict, tested by the adversarial read. A comment is kept or moved only when the first read keeps it and the
 * adversary, looking for code that breaks the claim, finds none. Found code, an unsure adversary or a missing read leaves it
 * "not confirmed" with both opinions. A drop by the first read stands on its own: dropped comments are listed with their reason.
 */
export function combineReads(candidate: Candidate, first: Settled | null, rebuttal: Rebuttal | null): Settled {
  if (first === null) return unconfirmed(candidate, 'The second pass did not finish, so only the deterministic checks ran on this comment.')
  if (first.verdict === 'dropped' || first.verdict === 'unverified') return first
  if (rebuttal === null) return unconfirmed(candidate, 'The adversarial read did not finish, so this comment is not confirmed.')
  if (rebuttal.state === 'stands') return first
  if (rebuttal.state === 'refuted') {
    return unconfirmed(candidate, `A second read looked for code that breaks the claim and found some: ${rebuttal.quote ? `"${rebuttal.quote}". ` : ''}${quoted(rebuttal.reason)}`)
  }
  return unconfirmed(candidate, `A second read could not settle it from the code: ${quoted(rebuttal.reason)}`)
}

/** The first read's verdict on every candidate, checked against the code. Null when the read did not finish. */
export function settleFirst(candidates: readonly Candidate[], read: ReadonlyMap<number, RawVerdict> | null, doc: Doc): Map<number, Settled> | null {
  return read === null ? null : new Map(candidates.map((c) => [c.id, settle(c, read.get(c.id), doc)]))
}

/** The adversarial read's answer on every candidate, checked against the code. Null when the read did not finish. */
export function settleSecond(candidates: readonly Candidate[], read: ReadonlyMap<number, RawVerdict> | null, doc: Doc): Map<number, Rebuttal> | null {
  return read === null ? null : new Map(candidates.map((c) => [c.id, settleRebuttal(read.get(c.id), doc)]))
}

/** Where a numbered line sits: its text and, in a pull request, its file, line and side. `units` is the numbered diff, or null for a file. */
export function locatorFor(texts: readonly string[], units: readonly DiffUnit[] | null): (line: number) => Located {
  return (line) => {
    if (!units) return { text: texts[line - 1] ?? '', where: null }
    const u = units[line - 1]
    if (!u) return { text: '', where: null }
    // A header line names its file only; a context line has a new-side number; a changed line has the side it is on.
    const where =
      u.kind === 'meta'
        ? { file: u.file, line: 0, side: 'new' as const }
        : u.kind === 'del'
          ? { file: u.file, line: u.oldLine ?? 0, side: 'old' as const }
          : { file: u.file, line: u.newLine ?? 0, side: 'new' as const }
    return { text: u.shown, where }
  }
}

const WAITING = 'Waiting for the second pass: this comment has passed the checks only, and has not been read against the code yet.'

/**
 * Builds the comment list from the settled reads: every first-pass comment appears once, kept, moved, dropped or unverified.
 * Pure: the browser runs it on rows the server settled against the code. `waiting` is the view while the reads are still running.
 */
export function buildComments(
  candidates: readonly Candidate[],
  checkedDrops: readonly CheckedDrop[],
  firsts: ReadonlyMap<number, Settled> | null,
  seconds: ReadonlyMap<number, Rebuttal> | null,
  locate: (line: number) => Located,
  inPullRequest = false,
  waiting = false,
): ReviewComment[] {
  const make = (
    base: { id: number; fromLine: number; severity: ReviewComment['severity']; message: string; suggestion: string },
    s: Settled,
  ): ReviewComment => {
    const at = locate(s.line)
    const { id, fromLine, severity, message, suggestion } = base
    return { id, fromLine, severity, message, suggestion, line: s.line, verdict: s.verdict, decidedBy: s.decidedBy, reason: inPullRequest ? translateLines(s.reason, locate) : s.reason, evidence: s.evidence, code: at.text, where: at.where, support: s.support, claimKind: s.claimKind, supportLine: s.supportAt === null ? null : inPullRequest ? (locate(s.supportAt).where?.line || null) : s.supportAt }
  }
  const settled = candidates.map((c) => {
    const s = waiting
      ? unconfirmed(c, WAITING)
      : combineReads(c, firsts === null ? null : (firsts.get(c.id) ?? null), seconds === null ? null : (seconds.get(c.id) ?? null))
    const note = c.loweredFrom ? ` Severity lowered from ${c.loweredFrom}: the comment itself says the code is safe.` : ''
    return make(c, { ...s, reason: `${s.reason}${note}` })
  })
  const dropped = checkedDrops.map((d) =>
    make(d, { line: d.line, verdict: 'dropped', decidedBy: 'check', reason: d.reason, evidence: null, support: null, supportAt: null, claimKind: null }),
  )
  return [...settled, ...dropped].sort((a, b) => a.id - b.id)
}
