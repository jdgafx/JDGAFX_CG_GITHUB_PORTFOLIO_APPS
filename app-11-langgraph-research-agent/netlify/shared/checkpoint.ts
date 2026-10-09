import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Evidence } from './citations'
import { EDIT_LIMITS, type CheckpointKind, type CheckpointOffer } from './events'
import { isRecord } from './json'
import { MAX_REVISIONS, type ResearchValues, type TraceRow } from './graph/state'
import { EXTRACT_CHARS } from './wikipedia'

/**
 * A checkpoint leaves the server inside the page and comes back with the visitor's edit. Two choices make
 * that safe. The token is signed, so the page can read it but cannot change the pages the model will be told
 * to trust. And the edit is a separate field that is checked here, so it can only be a few search queries or one
 * short note, and it is only ever put into a user message, never into a system prompt.
 */

/** How long a token stays good. The sources were read live, so an old one is stale, not wrong. */
export const TOKEN_TTL_MS = 2 * 60 * 60 * 1000
/** The most bytes a resume request may carry: a signed state holds up to a dozen 2,500-character pages. */
export const MAX_RESUME_BODY_BYTES = 96 * 1024

const MAX_EVIDENCE = 12
const MAX_TRACE_ROWS = 30
const MAX_DRAFT_CHARS = 6_000
const MAX_QUESTION_CHARS = 500

/** The part of the graph state a checkpoint keeps. A plan checkpoint holds the first three; a critic one holds all. */
export interface Snapshot {
  kind: CheckpointKind
  visit: number
  question: string
  searchQueries: string[]
  trace: TraceRow[]
  evidence: Evidence[]
  toolRounds: number
  draftText: string
  draftTruncated: boolean
  revisions: number
}

export const BAD_TOKEN_MESSAGE = 'This checkpoint is not valid or has expired. Run the question again to get a new one.'

const b64 = (data: string | Buffer) => Buffer.from(data).toString('base64url')

/** One key per deployment, derived from the model key so nothing new has to be configured. */
function macOf(secret: string, body: string): Buffer {
  const key = createHmac('sha256', 'graphscout-checkpoint-v1').update(secret).digest()
  return createHmac('sha256', key).update(body).digest()
}

export function signSnapshot(snapshot: Snapshot, secret: string, now: number): string {
  const body = b64(JSON.stringify({ exp: now + TOKEN_TTL_MS, snapshot }))
  return `${body}.${b64(macOf(secret, body))}`
}

function isStringList(value: unknown, max: number, chars: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((item) => typeof item === 'string' && item.length <= chars)
}

function isEvidence(value: unknown): value is Evidence {
  return (
    isRecord(value) &&
    typeof value.n === 'number' &&
    typeof value.title === 'string' &&
    value.title.length <= 300 &&
    typeof value.url === 'string' &&
    value.url.startsWith('https://en.wikipedia.org/wiki/') &&
    value.url.length <= 600 &&
    typeof value.extract === 'string' &&
    value.extract.length <= EXTRACT_CHARS
  )
}

function isTraceRow(value: unknown): value is TraceRow {
  return (
    isRecord(value) &&
    typeof value.node === 'string' &&
    typeof value.visit === 'number' &&
    typeof value.status === 'string' &&
    typeof value.ms === 'number' &&
    typeof value.detail === 'string' &&
    value.detail.length <= 2_000
  )
}

/** A second look at the shape, so a bug in the signer could not let a malformed state reach the graph. */
export function isSnapshot(value: unknown): value is Snapshot {
  if (!isRecord(value)) return false
  const { kind, visit, question, searchQueries, trace, evidence, toolRounds, draftText, draftTruncated, revisions } = value
  return (
    (kind === 'plan' || kind === 'critic') &&
    typeof visit === 'number' &&
    typeof question === 'string' &&
    question.length <= MAX_QUESTION_CHARS * 2 &&
    isStringList(searchQueries, 6, EDIT_LIMITS.queryChars * 4) &&
    Array.isArray(trace) &&
    trace.length <= MAX_TRACE_ROWS &&
    trace.every(isTraceRow) &&
    Array.isArray(evidence) &&
    evidence.length <= MAX_EVIDENCE &&
    evidence.every(isEvidence) &&
    typeof toolRounds === 'number' &&
    typeof draftText === 'string' &&
    draftText.length <= MAX_DRAFT_CHARS &&
    typeof draftTruncated === 'boolean' &&
    typeof revisions === 'number' &&
    revisions >= 0 &&
    revisions <= MAX_REVISIONS
  )
}

/** The snapshot inside a token, or null when the token is malformed, forged or past its time. */
export function verifyToken(token: unknown, secret: string, now: number): Snapshot | null {
  if (typeof token !== 'string' || token.length > MAX_RESUME_BODY_BYTES) return null
  const [body, mac, extra] = token.split('.')
  if (!body || !mac || extra !== undefined) return null
  const expected = macOf(secret, body)
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const payload: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!isRecord(payload) || typeof payload.exp !== 'number' || payload.exp < now) return null
    return isSnapshot(payload.snapshot) ? payload.snapshot : null
  } catch {
    return null
  }
}

/** A step of the saved history: the node that runs next and the state it will read. */
export interface HistoryPoint {
  next: readonly string[]
  values: ResearchValues
}

function snapshotOf(kind: CheckpointKind, visit: number, values: ResearchValues): Snapshot {
  return {
    kind,
    visit,
    question: values.question,
    searchQueries: values.searchQueries,
    trace: values.trace,
    // A plan checkpoint is taken before any page is read, so these are empty there by construction.
    evidence: values.evidence,
    toolRounds: values.toolRounds,
    draftText: values.draftText,
    draftTruncated: values.draftTruncated,
    revisions: values.revisions,
  }
}

/**
 * The points of a finished run that can be rewound to, oldest first: just after the plan, and just before each
 * time the critic read a draft that it could still send back. `history` is the checkpointer's list of saved states.
 */
export function offersFrom(history: readonly HistoryPoint[], secret: string, now: number): CheckpointOffer[] {
  const offers: CheckpointOffer[] = []
  let criticVisit = 0
  for (const point of [...history].reverse()) {
    const { values } = point
    const titles = values.evidence.map((item) => item.title)
    if (point.next[0] === 'agent' && values.trace.length === 1 && values.trace[0]?.node === 'plan') {
      const snapshot = snapshotOf('plan', 1, values)
      offers.push({ kind: 'plan', visit: 1, token: signSnapshot(snapshot, secret, now), queries: values.searchQueries, sources: [] })
    } else if (point.next[0] === 'critic') {
      criticVisit += 1
      // A critic that has used up the revisions cannot be sent back to the draft, so there is nothing to edit there.
      if (values.revisions >= MAX_REVISIONS || values.draftText === '') continue
      const snapshot = snapshotOf('critic', criticVisit, values)
      offers.push({ kind: 'critic', visit: criticVisit, token: signSnapshot(snapshot, secret, now), draft: values.draftText, sources: titles })
    }
  }
  return offers
}

export type EditResult<T> = { ok: true; value: T } | { ok: false; message: string }

// Words that try to talk to the model about its rules. The edit only ever lands in a user message, so this is a
// second layer: it keeps an obvious attempt from running at all and tells the visitor why.
const INSTRUCTION_PATTERNS = [
  /\b(ignore|disregard|forget|override|bypass)\b[^.]{0,40}\b(instruction|rule|prompt|polic|guideline|above|previous|earlier)/i,
  /\b(system|developer)\s*(prompt|message|instruction)/i,
  /(^|\n)\s*(system|assistant|developer)\s*:/i,
  /<\|/,
  /\bdo not cite\b|\bwithout (a )?citation/i,
]
export const INSTRUCTION_MESSAGE = 'Say what to change in the research, not how the model should behave. Remove words about rules or instructions.'

// eslint-disable-next-line no-control-regex -- the point is to refuse control characters
const CONTROL = /[\u0000-\u001f\u007f]/

const lengthOf = (text: string) => Array.from(text).length

/** The search queries a plan edit may set: 1 to 3, each 1 to 120 characters, plain text. */
export function validateQueries(raw: unknown): EditResult<string[]> {
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === 'string')) {
    return { ok: false, message: 'The queries must be a list of text.' }
  }
  const queries = [...new Set(raw.map((item: string) => item.replace(/\s+/g, ' ').trim()).filter((item) => item !== ''))]
  if (queries.length < 1 || queries.length > EDIT_LIMITS.maxQueries) {
    return { ok: false, message: `Give 1 to ${EDIT_LIMITS.maxQueries} search queries.` }
  }
  for (const query of queries) {
    if (lengthOf(query) > EDIT_LIMITS.queryChars) {
      return { ok: false, message: `Each query must be at most ${EDIT_LIMITS.queryChars} characters.` }
    }
    if (CONTROL.test(query)) return { ok: false, message: 'Queries must be plain text.' }
    if (INSTRUCTION_PATTERNS.some((pattern) => pattern.test(query))) return { ok: false, message: INSTRUCTION_MESSAGE }
  }
  return { ok: true, value: queries }
}

/** The note a critic edit may set: one short plain-text instruction about the answer. */
export function validateNotes(raw: unknown): EditResult<string> {
  if (typeof raw !== 'string') return { ok: false, message: 'The note must be text.' }
  const notes = raw.replace(/\s+/g, ' ').trim()
  if (notes === '') return { ok: false, message: 'Write what the critic should ask for.' }
  if (lengthOf(notes) > EDIT_LIMITS.notesChars) {
    return { ok: false, message: `The note must be at most ${EDIT_LIMITS.notesChars} characters.` }
  }
  if (CONTROL.test(notes)) return { ok: false, message: 'The note must be plain text.' }
  if (INSTRUCTION_PATTERNS.some((pattern) => pattern.test(notes))) return { ok: false, message: INSTRUCTION_MESSAGE }
  return { ok: true, value: notes }
}

/** The state to write back into a new thread, the node whose output it stands for, and how many rows are the original's. */
export interface Rewind {
  values: Partial<ResearchValues>
  asNode: 'plan' | 'critic'
  /** The first rows of the trace belong to the original run. */
  reusedRows: number
}

export type EditInput = { queries: unknown } | { notes: unknown }

/**
 * Builds the rewind for a verified snapshot and a checked edit. A plan edit replaces the plan's queries, so every
 * step after the plan runs again. A critic edit makes the critic send the draft back with the visitor's note, so the
 * draft, the next review and the final step run again.
 */
export function rewindFor(snapshot: Snapshot, edit: unknown): EditResult<Rewind> {
  if (!isRecord(edit)) return { ok: false, message: 'The request needs an edit.' }
  if (snapshot.kind === 'plan') {
    const checked = validateQueries(edit.queries)
    if (!checked.ok) return checked
    // The edited plan row keeps no model, tokens or cost: the model did not write these queries.
    const trace = snapshot.trace.map((row, i): TraceRow =>
      i === snapshot.trace.length - 1 && row.node === 'plan'
        ? { node: row.node, visit: row.visit, status: 'ok', ms: 0, detail: `Searches set by you: ${checked.value.join('; ')}`, edited: true }
        : row,
    )
    return {
      ok: true,
      value: { values: { question: snapshot.question, searchQueries: checked.value, trace }, asNode: 'plan', reusedRows: trace.length - 1 },
    }
  }
  const checked = validateNotes(edit.notes)
  if (!checked.ok) return checked
  if (snapshot.revisions >= MAX_REVISIONS) {
    return { ok: false, message: `The critic has already sent this draft back ${MAX_REVISIONS} times.` }
  }
  const revisions = snapshot.revisions + 1
  const row: TraceRow = {
    node: 'critic',
    visit: snapshot.visit,
    status: 'ok',
    ms: 0,
    detail: `The critic's review was replaced by your note: ${checked.value}`,
    next: `revise (${revisions} of ${MAX_REVISIONS})`,
    edited: true,
  }
  return {
    ok: true,
    value: {
      values: {
        question: snapshot.question,
        searchQueries: snapshot.searchQueries,
        evidence: snapshot.evidence,
        toolRounds: snapshot.toolRounds,
        draftText: snapshot.draftText,
        draftTruncated: snapshot.draftTruncated,
        draftReviewed: true,
        revisions,
        critique: { verdict: 'revise', notes: checked.value, reviewed: true },
        route: { to: 'draft', label: `revise (${revisions} of ${MAX_REVISIONS})` },
        trace: [...snapshot.trace, row],
      },
      asNode: 'critic',
      reusedRows: snapshot.trace.length,
    },
  }
}
