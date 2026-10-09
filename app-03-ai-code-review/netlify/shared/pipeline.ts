import type { ReviewResult } from '../../src/types'
import { buildDiff, MAX_DIFF_CHARS, type PrFileInput } from './diff'
import { diffDoc, fileDoc } from './anchor'
import { PASS1, PASS2, TOTAL_MS, callLimit } from './budget'
import { callModel, type Attempt } from './model'
import { MAX_OUTPUT_TOKENS, chatBody, replyCutShort, replyText, type ProviderReply } from './provider'
import { buildPrPrompt, buildSystemPrompt, commentBudget, parseReview, precheck } from './review'
import { noun, record, type Run } from './trace'
import { assemble, buildVerifyPrompt, buildVerifyUser, readVerdicts } from './verify'

export type ReviewInput =
  | { kind: 'file'; lang: string; lines: string[] }
  | { kind: 'pr'; files: PrFileInput[] }

export type Outcome =
  | { ok: true; result: ReviewResult; model: string | null }
  | { ok: false; error: string; status: number; headers?: Record<string, string> }

const PASS2_MAX_TOKENS = 3000
/** The reviewer is asked for the budget; a few more are still checked, so the cut falls on the second pass, not on file order. */
const OVERSHOOT = 5
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

const numbered = (texts: string[]) => texts.map((text, i) => `${i + 1}\t| ${text}`).join('\n')

function noteReply(run: Run, reply: ProviderReply): void {
  run.usages.push(reply.usage ?? {})
  run.model = reply.model ?? run.model
}

const remaining = (run: Run) => TOTAL_MS - (Date.now() - run.started)

/**
 * One model call with its own limit and, when the budget allows, one automatic retry after a timeout or a lost
 * connection. Rejections (4xx), rate limits and provider errors are never retried. Each try is a trace row.
 */
async function callWithRetry(
  run: Run,
  name: string,
  pass: typeof PASS1,
  reserve: number,
  body: string,
  apiKey: string,
  acceptable?: (reply: ProviderReply) => string | null,
): Promise<{ attempt: Attempt; problem: string | null }> {
  let note = ''
  for (let tryNo = 1; tryNo <= 2; tryNo += 1) {
    const limit = callLimit(pass, remaining(run), reserve)
    const label = tryNo === 1 ? name : `${name} retry`
    const startedAt = Date.now()
    if (limit === null) {
      const detail =
        tryNo === 1
          ? 'No time left in the run budget for this call'
          : `Not retried: ${seconds(Math.max(0, remaining(run)))} left is less than a healthy call needs`
      record(run, label, tryNo === 1 ? 'failed' : 'skipped', startedAt, detail)
      const failed: Attempt = { ok: false, status: 504, detail, message: 'The AI provider did not answer in time.', retryable: false }
      return { attempt: failed, problem: null }
    }
    const attempt = await callModel(apiKey, body, limit)
    if (!attempt.ok) {
      record(run, label, 'failed', startedAt, `${note}${attempt.detail} (limit ${seconds(limit)})`)
      if (!attempt.retryable || tryNo === 2) return { attempt, problem: null }
      note = `Retried once after: ${attempt.detail}. `
      continue
    }
    noteReply(run, attempt.reply)
    const problem = acceptable?.(attempt.reply) ?? null
    const detail = `${note}Reply received (limit ${seconds(limit)}, healthy p95 ${seconds(pass.p95)})`
    if (problem && tryNo === 1 && callLimit(pass, remaining(run), reserve) !== null) {
      record(run, label, 'ok', startedAt, `${detail}, but it was ${problem}`, attempt.reply.usage)
      note = `Retried once because the first reply was ${problem}. `
      continue
    }
    record(run, label, 'ok', startedAt, problem ? `${detail}; ${problem}` : detail, attempt.reply.usage)
    return { attempt, problem }
  }
  throw new Error('unreachable')
}

const failure = (attempt: Extract<Attempt, { ok: false }>): Outcome => {
  return { ok: false, error: attempt.message, status: attempt.status, headers: attempt.headers }
}

export async function runPipeline(run: Run, input: ReviewInput, apiKey: string): Promise<Outcome> {
  const buildAt = Date.now()
  const isPr = input.kind === 'pr'
  const built = isPr ? buildDiff(input.files) : null
  const texts = isPr ? built!.units.map((u) => u.shown) : input.lines
  const doc = isPr ? diffDoc(built!.units) : fileDoc(input.lines)
  const lineCount = texts.length
  const sizeForBudget = isPr ? built!.changed : lineCount
  const maxComments = commentBudget(sizeForBudget)
  const system = isPr ? buildPrPrompt(lineCount, built!.changed, maxComments) : buildSystemPrompt(input.lang, lineCount, maxComments)
  const listing = numbered(texts)
  const user = isPr
    ? `Review this pull request diff (${noun(lineCount, 'line')}, ${noun(built!.changed, 'changed line')}):\n\n${listing}`
    : `Review this ${input.lang} file (${noun(lineCount, 'line')}):\n\n${listing}`
  record(
    run,
    'Build prompt',
    'ok',
    buildAt,
    isPr
      ? `Numbered ${noun(lineCount, 'diff line')} (${noun(built!.changed, 'changed line')}) from ${noun(input.files.length, 'file')}, up to ${noun(maxComments, 'comment')}, ${MAX_OUTPUT_TOKENS}-token cap, reasoning off`
      : `Numbered ${noun(lineCount, 'line')}, up to ${noun(maxComments, 'comment')}, ${MAX_OUTPUT_TOKENS}-token cap, reasoning off`,
  )
  const locate = (line: number) => {
    if (!built) return { text: texts[line - 1] ?? '', where: null }
    const u = built.units[line - 1]
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

  // Pass 1: the review.
  const first = await callWithRetry(
    run,
    'Pass 1: review',
    PASS1,
    PASS2.p50,
    chatBody(system, user),
    apiKey,
    (reply) => {
      const text = replyText(reply)
      if (!text) return 'empty'
      if (replyCutShort(reply)) return 'cut short'
      return parseReview(text) === null ? 'not a readable JSON review' : null
    },
  )
  if (!first.attempt.ok) return failure(first.attempt)
  const reply = first.attempt.reply
  const parseAt = Date.now()
  const text = replyText(reply)
  const truncated = replyCutShort(reply)
  if (!text) {
    record(run, 'Parse reply', 'failed', parseAt, 'The reply had no content')
    return { ok: false, error: 'The AI returned an empty review. Please try again.', status: 502 }
  }
  const parsed = parseReview(text)
  if (!parsed) {
    record(run, 'Parse reply', 'failed', parseAt, truncated ? 'The reply was cut short before the JSON closed' : 'The reply was not a readable JSON object')
    return {
      ok: false,
      error: truncated
        ? 'The review was cut short before it could be read. Try a shorter snippet.'
        : 'The AI response could not be read. Please try again.',
      status: 502,
    }
  }
  const raw = Array.isArray(parsed.comments) ? parsed.comments.length : 0
  record(run, 'Parse reply', 'ok', parseAt, `Read the JSON review: ${noun(raw, 'comment')}`)

  // Deterministic checks on the first pass.
  const checkAt = Date.now()
  const checked = precheck(parsed.comments, doc, maxComments + OVERSHOOT)
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

  // Pass 2: a second model reads every surviving comment against the code.
  let verdicts: ReturnType<typeof readVerdicts> = null
  if (checked.candidates.length === 0) {
    record(run, 'Pass 2: verify', 'skipped', Date.now(), 'Not needed: no comment was left to verify')
  } else {
    const second = await callWithRetry(
      run,
      'Pass 2: verify',
      PASS2,
      0,
      chatBody(buildVerifyPrompt(input.kind, lineCount), buildVerifyUser(listing, checked.candidates, texts), PASS2_MAX_TOKENS),
      apiKey,
      (reply) => {
        if (replyCutShort(reply)) return 'cut short'
        const read = readVerdicts(replyText(reply))
        if (read === null) return 'not a readable list of verdicts'
        const missing = checked.candidates.filter((c) => !read.has(c.id)).length
        return missing > 0 ? `missing ${missing} of ${checked.candidates.length} verdicts` : null
      },
    )
    if (second.attempt.ok) {
      verdicts = readVerdicts(replyText(second.attempt.reply))
      // Both tries gave a reply that is not a list of verdicts: the pass failed, and its last row says so.
      if (verdicts === null) {
        const last = run.trace[run.trace.length - 1]
        if (last) last.status = 'failed'
      }
    }
  }

  // Re-validate each verdict against the code, then build the list.
  const validateAt = Date.now()
  const comments = assemble(checked.candidates, checked.dropped, verdicts, doc, locate)
  const count = (v: string) => comments.filter((c) => c.verdict === v).length
  const verified = checked.candidates.length === 0 || verdicts !== null
  record(
    run,
    'Re-validate',
    'ok',
    validateAt,
    verified
      ? `Every verdict checked against the code: ${count('kept')} kept, ${count('moved')} moved, ${count('dropped')} dropped, ${count('unverified')} not confirmed`
      : `The second pass did not finish: ${noun(count('unverified'), 'comment')} shown as unverified, ${count('dropped')} dropped by the checks`,
  )

  return {
    ok: true,
    model: reply.model ?? run.model,
    result: {
      comments,
      lineCount,
      truncated,
      verified,
      malformed: checked.malformed,
      mode: input.kind,
      pr: built ? { filesIncluded: input.kind === 'pr' ? input.files.length : 0, changedIncluded: built.changed, charsIncluded: built.chars, charLimit: MAX_DIFF_CHARS } : null,
    },
  }
}
