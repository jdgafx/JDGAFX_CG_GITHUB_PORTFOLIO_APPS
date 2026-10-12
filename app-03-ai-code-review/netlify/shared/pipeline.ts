import type { ModelCheck, ReviewResult, ServedCall } from '../../src/types'
import { buildDiff, MAX_DIFF_CHARS, type PrFileInput } from './diff'
import { diffDoc, fileDoc } from './anchor'
import { PASS1, PASS2, SAFETY_MS, TOTAL_MS, callLimit } from './budget'
import { batchesOf } from './batches'
import { HANDOFF_REFUSED, makeHandoff, type Opened } from './handoff'
import { newestModel, servedCheck, waitForNewest } from './newest-model'
import { callModel, type Attempt } from './model'
import { MAX_OUTPUT_TOKENS, MODEL, chatBody, replyCutShort, replyText, type ProviderReply } from './provider'
import { buildPrPrompt, buildSystemPrompt, commentBudget, parseReview, precheck } from './review'
import { noun, record, type Run } from './trace'
import { buildComments, buildRefutePrompt, buildVerifyPrompt, buildVerifyUser, locatorFor, readVerdicts, settleFirst, settleSecond } from './verify'
import type { FirstPassReply, FirstRow, SecondRow } from './wire'

export type ReviewInput =
  | { kind: 'file'; lang: string; lines: string[] }
  | { kind: 'pr'; files: PrFileInput[] }

type Failed = { ok: false; error: string; status: number; headers?: Record<string, string> }
export type FirstOutcome = ({ ok: true; model: string | null } & FirstPassReply) | Failed
export type ReadOutcome = { ok: true; read: 1 | 2; rows: FirstRow[] | SecondRow[] } | Failed

/** The old 3,000 for the verdicts and their typed claims, plus 2,000 for thinking, which counts toward the cap. */
const PASS2_MAX_TOKENS = 5000
/** The reviewer is asked for the budget; a few more are still checked, so the cut falls on the second pass, not on file order. */
const OVERSHOOT = 5
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

const numbered = (texts: string[]) => texts.map((text, i) => `${i + 1}\t| ${text}`).join('\n')

/** Shown when a reply ends at its token cap: thinking plus the answer used all the room, so what came back is not the whole answer. */
export const REVIEW_OUT_OF_LENGTH = 'The AI ran out of reply length before it finished the review. Try a shorter snippet.'
export const READ_OUT_OF_LENGTH = 'The AI ran out of reply length before it finished checking the comments. Try a shorter snippet.'

/** The model a reply names, or null. Never a model from another call: a reply that names none is not reported. */
const servedOf = (reply: ProviderReply): string | null => (typeof reply.model === 'string' && reply.model !== '' ? reply.model : null)

function noteReply(run: Run, pass: string, reply: ProviderReply): void {
  run.usages.push(reply.usage ?? {})
  run.served.push({ pass, model: servedOf(reply) })
}

/** The order of the checks, worst last: a mismatch on any call is the check the run shows. */
const RANK: Record<ModelCheck, number> = { match: 0, unchecked: 1, 'not-reported': 2, mismatch: 3 }

const remaining = (run: Run) => TOTAL_MS - (Date.now() - run.started)

/**
 * The newest model, the worst check across every call, and each call's served model. A console warning goes out for
 * every call that named a model other than the newest. The list is waited for only within what is left of the request's budget.
 */
export async function settleModel(run: Run): Promise<{ newestModel: string | null; modelCheck: ModelCheck; servedModels: ServedCall[] }> {
  if (run.served.length === 0 || !run.newest) return { newestModel: null, modelCheck: 'not-reported', servedModels: [] }
  const newest = await waitForNewest(run.newest, remaining(run) - SAFETY_MS)
  const checks = run.served.map((call) => servedCheck(newest, call.model))
  run.served.forEach((call, i) => {
    if (checks[i] === 'mismatch') console.warn(`model mismatch: served ${call.model}, newest ${newest}, requested ${MODEL}`)
  })
  const modelCheck = checks.reduce((worst, check) => (RANK[check] > RANK[worst] ? check : worst))
  return { newestModel: newest, modelCheck, servedModels: run.served }
}

/**
 * One model call with its own limit and, when the request's budget allows, one automatic retry after a timeout or a lost
 * connection. Rejections (4xx), rate limits and provider errors are never retried. Each try is a trace row.
 */
async function callWithRetry(
  run: Run,
  name: string,
  pass: typeof PASS1,
  body: string,
  apiKey: string,
  acceptable?: (reply: ProviderReply) => string | null,
): Promise<{ attempt: Attempt; problem: string | null }> {
  let note = ''
  for (let tryNo = 1; tryNo <= 2; tryNo += 1) {
    const limit = callLimit(pass, remaining(run))
    const label = tryNo === 1 ? name : `${name} retry`
    const startedAt = Date.now()
    if (limit === null) {
      const detail =
        tryNo === 1
          ? 'No time left in the request budget for this call'
          : `Not retried: ${seconds(Math.max(0, remaining(run)))} left is less than a healthy call needs`
      record(run, label, tryNo === 1 ? 'failed' : 'skipped', startedAt, detail)
      const failed: Attempt = { ok: false, status: 504, detail, message: 'The AI provider did not answer in time.', retryable: false, billedUnknown: false }
      return { attempt: failed, problem: null }
    }
    const attempt = await callModel(apiKey, body, limit)
    if (!attempt.ok) {
      record(run, label, 'failed', startedAt, `${note}${attempt.detail} (limit ${seconds(limit)})`, undefined, attempt.billedUnknown)
      if (!attempt.retryable || tryNo === 2) return { attempt, problem: null }
      note = `Retried once after: ${attempt.detail}. `
      continue
    }
    noteReply(run, name, attempt.reply)
    // A reply is counted by its usage block; one without a total is a billed call we cannot count.
    const unreported = typeof attempt.reply.usage?.total_tokens !== 'number'
    const problem = acceptable?.(attempt.reply) ?? null
    const detail = `${note}Reply received (limit ${seconds(limit)}, healthy p95 ${seconds(pass.p95)})`
    if (problem && tryNo === 1 && callLimit(pass, remaining(run)) !== null) {
      record(run, label, 'ok', startedAt, `${detail}, but it was ${problem}`, attempt.reply, unreported)
      note = `Retried once because the first reply was ${problem}. `
      continue
    }
    record(run, label, 'ok', startedAt, problem ? `${detail}; ${problem}` : detail, attempt.reply, unreported)
    return { attempt, problem }
  }
  throw new Error('unreachable')
}

const failure = (attempt: Extract<Attempt, { ok: false }>): Failed => {
  return { ok: false, error: attempt.message, status: attempt.status, headers: attempt.headers }
}

/** Marks the last row of a call as failed: its reply came back but could not be used. */
function failLastRow(run: Run, label: string): void {
  const rows = run.trace.filter((s) => s.name === label || s.name === `${label} retry`)
  const last = rows[rows.length - 1]
  if (last) last.status = 'failed'
}

/** The numbered code or diff both kinds of request work from, built the same way every time so the requests agree. */
function prepare(input: ReviewInput) {
  const isPr = input.kind === 'pr'
  const built = isPr ? buildDiff(input.files) : null
  const texts = isPr ? built!.units.map((u) => u.shown) : input.lines
  const doc = isPr ? diffDoc(built!.units) : fileDoc(input.lines)
  const lineCount = texts.length
  const maxComments = commentBudget(isPr ? built!.changed : lineCount)
  return { built, texts, doc, lineCount, maxComments, listing: numbered(texts), locate: locatorFor(texts, built ? built.units : null) }
}

/**
 * Request 1: the review. Calls pass 1, reads its reply, runs the deterministic checks and returns the comments that passed them,
 * as a view that confirms nothing, with the signed hand-off the read requests need. A reply cut off at its token cap is never read.
 */
export async function runFirstPass(run: Run, input: ReviewInput, apiKey: string): Promise<FirstOutcome> {
  // One list promise per request, started before the model call so it runs alongside pass 1.
  run.newest = newestModel()
  const buildAt = Date.now()
  const isPr = input.kind === 'pr'
  const { built, doc, lineCount, maxComments, listing, locate } = prepare(input)
  const system = isPr ? buildPrPrompt(lineCount, built!.changed, maxComments) : buildSystemPrompt(input.lang, lineCount, maxComments)
  const user = isPr
    ? `Review this pull request diff (${noun(lineCount, 'line')}, ${noun(built!.changed, 'changed line')}):\n\n${listing}`
    : `Review this ${input.lang} file (${noun(lineCount, 'line')}):\n\n${listing}`
  record(
    run,
    'Build prompt',
    'ok',
    buildAt,
    isPr
      ? `Numbered ${noun(lineCount, 'diff line')} (${noun(built!.changed, 'changed line')}) from ${noun(input.files.length, 'file')}, up to ${noun(maxComments, 'comment')}, ${MAX_OUTPUT_TOKENS}-token cap, thinking on`
      : `Numbered ${noun(lineCount, 'line')}, up to ${noun(maxComments, 'comment')}, ${MAX_OUTPUT_TOKENS}-token cap, thinking on`,
  )

  const first = await callWithRetry(run, 'Pass 1: review', PASS1, chatBody(system, user), apiKey, (reply) => {
    const text = replyText(reply)
    if (!text) return 'empty'
    if (replyCutShort(reply)) return 'cut short'
    return parseReview(text) === null ? 'not a readable JSON review' : null
  })
  if (!first.attempt.ok) return failure(first.attempt)
  const reply = first.attempt.reply
  run.model = servedOf(reply)
  const parseAt = Date.now()
  // A cut-off reply is not read, however much of it parses: it is not the whole answer.
  if (replyCutShort(reply)) {
    record(run, 'Parse reply', 'failed', parseAt, 'The reply ended at its token limit (finish_reason length), so it was not read')
    return { ok: false, error: REVIEW_OUT_OF_LENGTH, status: 502 }
  }
  const text = replyText(reply)
  if (!text) {
    record(run, 'Parse reply', 'failed', parseAt, 'The reply had no content')
    return { ok: false, error: 'The AI returned an empty review. Please try again.', status: 502 }
  }
  const parsed = parseReview(text)
  if (!parsed) {
    record(run, 'Parse reply', 'failed', parseAt, 'The reply was not a readable JSON object')
    return { ok: false, error: 'The AI response could not be read. Please try again.', status: 502 }
  }
  const comments = Array.isArray(parsed.comments) ? parsed.comments : []
  record(run, 'Parse reply', 'ok', parseAt, `Read the JSON review: ${noun(comments.length, 'comment')}`)

  // Deterministic checks on the first pass.
  const checkAt = Date.now()
  const checked = precheck(comments, doc, maxComments + OVERSHOOT)
  const movedByChecks = checked.candidates.filter((c) => c.moveNote).length
  record(
    run,
    'Checks',
    'ok',
    checkAt,
    [
      `${noun(checked.candidates.length, 'comment')} passed`,
      movedByChecks > 0 ? `${movedByChecks} moved to the line they quote` : '',
      checked.dropped.length > 0 ? `${checked.dropped.length} dropped, each with its reason` : '',
      checked.malformed > 0 ? `${checked.malformed} unreadable` : '',
    ]
      .filter(Boolean)
      .join(', '),
  )

  // With nothing left to read, the checks are the whole review and there is no second pass to wait for.
  const nothingToRead = checked.candidates.length === 0
  if (nothingToRead) {
    record(run, 'Pass 2: verify (read 1)', 'skipped', Date.now(), 'Not needed: no comment was left to verify')
    record(run, 'Re-validate', 'ok', Date.now(), `Nothing to verify: ${noun(checked.dropped.length, 'comment')} dropped by the checks`)
  }
  const batches = batchesOf(checked.candidates.map((c) => c.id))
  const view = buildComments(checked.candidates, checked.dropped, null, null, locate, isPr, !nothingToRead)
  const result: ReviewResult = {
    comments: view,
    lineCount,
    truncated: false,
    verified: nothingToRead,
    malformed: checked.malformed,
    mode: input.kind,
    pr: built ? { filesIncluded: input.kind === 'pr' ? input.files.length : 0, changedIncluded: built.changed, charsIncluded: built.chars, charLimit: MAX_DIFF_CHARS } : null,
  }
  return {
    ok: true,
    model: run.model,
    result,
    candidates: checked.candidates,
    dropped: checked.dropped,
    batches,
    handoff: nothingToRead ? null : makeHandoff(apiKey, input, comments, batches),
  }
}

/**
 * Requests 2 and 3: one read of pass 2. The comments come from the browser, so they are re-checked from the raw first-pass
 * text against the code in this request, and every verdict is checked against the code again before it is returned. A reply cut
 * off at its token cap is never read.
 */
export async function runRead(run: Run, input: ReviewInput, apiKey: string, n: 1 | 2, opened: Opened, batch: number): Promise<ReadOutcome> {
  run.newest = newestModel()
  const { texts, doc, lineCount, maxComments, listing } = prepare(input)
  const checked = precheck(opened.comments, doc, maxComments + OVERSHOOT)
  // The signed batches must be the batches of the comments that pass the checks here: anything else is not the record pass 1 made.
  if (JSON.stringify(batchesOf(checked.candidates.map((c) => c.id))) !== JSON.stringify(opened.batches)) {
    return { ok: false, error: HANDOFF_REFUSED, status: 400 }
  }
  const ids = opened.batches[batch]
  if (!ids) return { ok: false, error: 'That batch is not part of this review.', status: 400 }
  const mine = checked.candidates.filter((c) => ids.includes(c.id))
  const label = `${n === 1 ? 'Pass 2: verify (read 1' : 'Pass 2: verify (read 2, adversary'}${opened.batches.length > 1 ? `, batch ${batch + 1} of ${opened.batches.length}` : ''})`
  // The second read sees the comments in the opposite order, so the two reads do not follow each other's pattern.
  const order = n === 1 ? mine : [...mine].reverse()
  const attempt = await callWithRetry(
    run,
    label,
    PASS2,
    chatBody(n === 1 ? buildVerifyPrompt(input.kind, lineCount) : buildRefutePrompt(input.kind, lineCount), buildVerifyUser(listing, order, texts, doc.texts), PASS2_MAX_TOKENS),
    apiKey,
    (reply) => {
      if (replyCutShort(reply)) return 'cut short'
      const read = readVerdicts(replyText(reply))
      if (read === null) return 'not a readable list of verdicts'
      const missing = mine.filter((c) => !read.has(c.id)).length
      return missing > 0 ? `missing ${missing} of ${mine.length} verdicts` : null
    },
  )
  if (!attempt.attempt.ok) return failure(attempt.attempt)
  const reply = attempt.attempt.reply
  if (replyCutShort(reply)) {
    failLastRow(run, label)
    return { ok: false, error: READ_OUT_OF_LENGTH, status: 502 }
  }
  const read = readVerdicts(replyText(reply))
  // Both tries gave a reply that is not a list of verdicts: the read failed, and its last row says so.
  if (read === null) {
    failLastRow(run, label)
    return { ok: false, error: 'The AI response could not be read. Please try again.', status: 502 }
  }
  if (n === 1) {
    const rows = [...(settleFirst(mine, read, doc) ?? [])].map(([id, s]) => ({ id, ...s }))
    return { ok: true, read: 1, rows }
  }
  const rows = [...(settleSecond(mine, read, doc) ?? [])].map(([id, s]) => ({ id, ...s }))
  return { ok: true, read: 2, rows }
}
