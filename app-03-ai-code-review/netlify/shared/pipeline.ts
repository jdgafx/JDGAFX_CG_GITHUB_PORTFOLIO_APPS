import type { ModelCheck, ReviewResult, ServedCall } from '../../src/types'
import { buildDiff, MAX_DIFF_CHARS, type PrFileInput } from './diff'
import { diffDoc, fileDoc } from './anchor'
import { PASS1, PASS2, SAFETY_MS, TOTAL_MS, callLimit } from './budget'
import { batchesOf } from './batches'
import { HANDOFF_EXPIRED, HANDOFF_REFUSED, makeHandoff, makeShardRecord, openShardRecord, type Opened } from './handoff'
import { newestModel, servedCheck, waitForNewest } from './newest-model'
import { callModel, type Attempt } from './model'
import { MAX_OUTPUT_TOKENS, MODEL, chatBody, replyEnding, replyText, type ProviderReply } from './provider'
import { buildPrPrompt, buildSystemPrompt, commentBudget, parseReview, precheck } from './review'
import { noun, record, type Run } from './trace'
import { buildComments, buildRefutePrompt, buildVerifyPrompt, buildVerifyUser, locatorFor, readVerdicts, settleFirst, settleSecond } from './verify'
import { mergeComments, planShards, type Shard } from './shards'
import type { FirstPassReply, FirstRow, SecondRow, ShardNote, Ticket } from './wire'

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
/** A reply that did not end with finish_reason stop, and did not run out of length either (none given, a filter, a tool call). */
export const REVIEW_UNFINISHED = 'The AI did not finish its reply. Please try again.'
export const READ_UNFINISHED = 'The AI did not finish checking the comments. Please try again.'

/** Why a reply is not read, or null when it ended with finish_reason stop. */
const unusable = (reply: ProviderReply): string | null => {
  const ending = replyEnding(reply)
  return ending === 'complete' ? null : ending === 'length' ? 'cut short' : 'not finished'
}
const finishOf = (reply: ProviderReply) => reply.choices?.[0]?.finish_reason ?? 'none'

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

/** The shards of this input: one for a small file or diff. The browser plans them the same way to know how many requests to send. */
export function shardsOf(input: ReviewInput): Shard[] {
  const { texts, built, maxComments } = prepare(input)
  return planShards(texts, built ? built.units : null, maxComments)
}

/** The raw comments one shard wrote for its range. */
type ShardComments = { ok: true; comments: unknown[] } | Failed

/**
 * One call of pass 1 for one range of the numbered input. The whole input goes with it, the range is the only part the model is
 * asked to comment on, and its reply is capped at what the measured token rate fits inside the time limit. A reply that did not end
 * with finish_reason stop is never read. `many` is true when the review has more than one shard; the rows then name the range.
 */
async function callShard(run: Run, input: ReviewInput, apiKey: string, shard: Shard, many: boolean): Promise<ShardComments> {
  const buildAt = Date.now()
  const isPr = input.kind === 'pr'
  const { built, lineCount, listing } = prepare(input)
  const range = many ? { from: shard.from, to: shard.to } : undefined
  const where = many ? ` (lines ${shard.from}-${shard.to})` : ''
  const changedHere = built ? built.units.slice(shard.from - 1, shard.to).filter((u) => u.kind === 'add' || u.kind === 'del').length : 0
  const system = isPr ? buildPrPrompt(lineCount, built!.changed, shard.budget, range) : buildSystemPrompt(input.lang, lineCount, shard.budget, range)
  const user = isPr
    ? `Review this pull request diff (${noun(lineCount, 'line')}, ${noun(built!.changed, 'changed line')})${many ? `, lines ${shard.from} to ${shard.to} only` : ''}:\n\n${listing}`
    : `Review this ${input.lang} file (${noun(lineCount, 'line')})${many ? `, lines ${shard.from} to ${shard.to} only` : ''}:\n\n${listing}`
  record(
    run,
    `Build prompt${where}`,
    'ok',
    buildAt,
    (isPr
      ? `Numbered ${noun(lineCount, 'diff line')} (${noun(built!.changed, 'changed line')}) from ${noun(input.files.length, 'file')}`
      : `Numbered ${noun(lineCount, 'line')}`) +
      `${many ? `, reviewing lines ${shard.from} to ${shard.to}${isPr ? ` (${noun(changedHere, 'changed line')})` : ''}` : ''}, up to ${noun(shard.budget, 'comment')}, ${MAX_OUTPUT_TOKENS}-token cap, thinking on`,
  )

  const label = `Pass 1: review${where}`
  const first = await callWithRetry(run, label, PASS1, chatBody(system, user), apiKey, (reply) => {
    const text = replyText(reply)
    if (!text) return 'empty'
    const cut = unusable(reply)
    if (cut) return cut
    return parseReview(text) === null ? 'not a readable JSON review' : null
  })
  if (!first.attempt.ok) return failure(first.attempt)
  const reply = first.attempt.reply
  // The model that wrote the review: the first shard's reply names it.
  run.model ??= servedOf(reply)
  const parseAt = Date.now()
  // Only a reply that ended with finish_reason stop is read, however much of any other parses: it is not the whole answer.
  const ending = replyEnding(reply)
  if (ending !== 'complete') {
    record(run, `Parse reply${where}`, 'failed', parseAt, `The reply ended with finish_reason ${finishOf(reply)}, so it was not read`)
    return { ok: false, error: ending === 'length' ? REVIEW_OUT_OF_LENGTH : REVIEW_UNFINISHED, status: 502 }
  }
  const text = replyText(reply)
  if (!text) {
    record(run, `Parse reply${where}`, 'failed', parseAt, 'The reply had no content')
    return { ok: false, error: 'The AI returned an empty review. Please try again.', status: 502 }
  }
  const parsed = parseReview(text)
  if (!parsed) {
    record(run, `Parse reply${where}`, 'failed', parseAt, 'The reply was not a readable JSON object')
    return { ok: false, error: 'The AI response could not be read. Please try again.', status: 502 }
  }
  const comments = Array.isArray(parsed.comments) ? parsed.comments : []
  record(run, `Parse reply${where}`, 'ok', parseAt, `Read the JSON review: ${noun(comments.length, 'comment')}`)
  return { ok: true, comments }
}

/**
 * The deterministic checks on the comments of pass 1 (all the shards', merged), and the first view of the review: the comments that
 * passed, none confirmed, with the signed hand-off the read requests need.
 */
function finishFirstPass(run: Run, input: ReviewInput, apiKey: string, comments: unknown[], shards: ShardNote[]): FirstOutcome {
  const isPr = input.kind === 'pr'
  const { built, doc, lineCount, maxComments, locate } = prepare(input)
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
    handoff: nothingToRead ? null : makeHandoff(apiKey, input, comments, batches, Date.now(), shards),
  }
}

/**
 * Request 1 of a review that is one shard: pass 1, the checks, and the first view with its signed hand-off. A review of more
 * than one shard is `runShard` for each shard and then `runMerge`.
 */
export async function runFirstPass(run: Run, input: ReviewInput, apiKey: string): Promise<FirstOutcome> {
  // One list promise per request, started before the model call so it runs alongside pass 1.
  run.newest = newestModel()
  const [only] = shardsOf(input)
  const got = await callShard(run, input, apiKey, only, false)
  if (!got.ok) return got
  return finishFirstPass(run, input, apiKey, got.comments, [{ from: only.from, to: only.to, ok: true }])
}

export type ShardOutcome = { ok: true; record: Ticket; model: string | null } | Failed

/** One shard of a review of several: pass 1 for its range, and the signed record of what it wrote, for the merge. */
export async function runShard(run: Run, input: ReviewInput, apiKey: string, index: number): Promise<ShardOutcome> {
  run.newest = newestModel()
  const plan = shardsOf(input)
  const got = await callShard(run, input, apiKey, plan[index], true)
  if (!got.ok) return got
  return { ok: true, record: makeShardRecord(apiKey, input, index, plan.length, got.comments), model: run.model }
}

/**
 * The merge of a review of several shards: it opens the records the shards signed (none it did not sign, for this code, within
 * three minutes), joins their comments, runs the checks on the whole and signs the hand-off the reads need. A shard that has no
 * record (its request failed) is a range that was not reviewed, and the hand-off says so.
 */
export function runMerge(run: Run, input: ReviewInput, apiKey: string, tickets: unknown): FirstOutcome {
  const plan = shardsOf(input)
  if (!Array.isArray(tickets) || tickets.length !== plan.length) return { ok: false, error: `This review is made of ${plan.length} parts, and the merge needs the record of each.`, status: 400 }
  const lists: unknown[][] = []
  const notes: ShardNote[] = []
  for (const [i, ticket] of tickets.entries()) {
    if (ticket === null) {
      notes.push({ from: plan[i].from, to: plan[i].to, ok: false })
      continue
    }
    const opened = openShardRecord(apiKey, input, ticket, i, plan.length)
    if (opened === null || opened === 'expired') {
      return { ok: false, error: opened === null ? HANDOFF_REFUSED : HANDOFF_EXPIRED, status: 400 }
    }
    lists.push(opened)
    notes.push({ from: plan[i].from, to: plan[i].to, ok: true })
  }
  if (lists.length === 0) return { ok: false, error: 'Every part of the review failed, so there is nothing to merge.', status: 400 }
  const mergeAt = Date.now()
  const merged = mergeComments(lists)
  record(
    run,
    'Merge shards',
    'ok',
    mergeAt,
    `Joined ${noun(lists.length, 'part')} of ${plan.length}: ${noun(merged.comments.length, 'comment')}${merged.duplicates > 0 ? `, ${merged.duplicates} duplicate${merged.duplicates === 1 ? '' : 's'} removed` : ''}${lists.length < plan.length ? `, ${noun(plan.length - lists.length, 'part')} not reviewed` : ''}`,
  )
  return finishFirstPass(run, input, apiKey, merged.comments, notes)
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
      const cut = unusable(reply)
      if (cut) return cut
      const read = readVerdicts(replyText(reply))
      if (read === null) return 'not a readable list of verdicts'
      const missing = mine.filter((c) => !read.has(c.id)).length
      return missing > 0 ? `missing ${missing} of ${mine.length} verdicts` : null
    },
  )
  if (!attempt.attempt.ok) return failure(attempt.attempt)
  const reply = attempt.attempt.reply
  const ending = replyEnding(reply)
  if (ending !== 'complete') {
    failLastRow(run, label)
    return { ok: false, error: ending === 'length' ? READ_OUT_OF_LENGTH : READ_UNFINISHED, status: 502 }
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
