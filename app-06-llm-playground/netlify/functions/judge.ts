import { JUDGE_BODY_MAX_BYTES, JUDGE_MAX_TOKENS, MODEL, type Cost, type JudgeResponse, type ModelCheck, type Usage } from '../shared/contract'
import { gate, json, readJson, remainingMs, SERVER_ERROR } from '../shared/guard'
import { usageFrom } from '../shared/measure'
import { checkRecord, NOT_CHECKED, newestModel } from '../shared/newest-model'
import { providerKey, replyOf } from '../shared/openrouter'
import { chatWithRetry } from '../shared/retry'
import { errorName, strOrNull } from '../shared/parse'
import { parseJudge } from '../shared/validate'
import { judgeMessages, parseVerdict } from '../shared/verdict'

export const config = { path: '/api/judge' }

// The judge thinks before it answers, which adds a few seconds, so it gets the whole 24 s request budget
// (remainingMs still caps it) and a 14 s first try. A second try then keeps up to 10 s.
const JUDGE_TIMEOUT_MS = 24_000
const JUDGE_ATTEMPT_MS = 14_000

export default async (req: Request): Promise<Response> => {
  const guard = gate(req, 'POST')
  if (!guard.ok) return guard.response
  try {
    const started = Date.now()
    const body = await readJson(req, JUDGE_BODY_MAX_BYTES)
    if (!body.ok) return json({ error: body.error }, 400, guard.headers)
    const parsed = parseJudge(body.value)
    if (!parsed.ok) return json({ error: parsed.error }, 400, guard.headers)
    const key = providerKey()
    if (!key) return json({ error: 'The server is missing its provider key' }, 503, guard.headers)

    const { prompt, answers } = parsed.value
    // No reasoning override: the judge thinks as Haiku does by default, and JUDGE_MAX_TOKENS leaves room for it.
    // Only the reply's content is read, so thinking text is never shown as the verdict.
    const newestP = newestModel()
    const result = await chatWithRetry(
      key,
      {
        model: MODEL,
        messages: judgeMessages(prompt, answers),
        max_tokens: JUDGE_MAX_TOKENS,
      },
      { budgetMs: Math.min(JUDGE_TIMEOUT_MS, remainingMs(started)), attemptMs: JUDGE_ATTEMPT_MS, signal: req.signal },
    )
    // A judge failure is a normal result for the page, so it returns 200 with ok: false.
    if (!result.ok) return json(failure(result.error, null, result.latencyMs, NOT_CHECKED, { notReported: result.lost }), 200, guard.headers)

    const served = strOrNull(result.data.model)
    const record = checkRecord(await newestP, served, MODEL)
    const { text } = replyOf(result.data)
    // The reply was billed whether or not it holds a verdict, so its usage rides on the failure too.
    const { usage, cost } = usageFrom(result.data, served, null)
    const billed = { usage, cost, notReported: result.lost + (usage.total_tokens === null && cost === null ? 1 : 0) }
    if (text.trim() === '') return json(failure('The judge returned no text', served, result.latencyMs, record, billed), 200, guard.headers)
    const verdict = parseVerdict(text, answers.map(answer => answer.slot))
    if (!verdict.ok) return json(failure(verdict.reason, served, result.latencyMs, record, billed), 200, guard.headers)

    const picked = verdict.bestOverall === 'tie' ? 'a tie' : `Panel ${verdict.bestOverall}`
    const response: JudgeResponse = {
      ok: true,
      model: served,
      latencyMs: result.latencyMs,
      bestOverall: verdict.bestOverall,
      perPanel: verdict.perPanel,
      caveat: verdict.caveat,
      usage,
      cost,
      notReported: billed.notReported,
      ...record,
      trace: [
        {
          name: 'Judge',
          status: 'ok',
          ms: result.latencyMs,
          detail: `${served ?? 'Model not reported'} picked ${picked}${result.retried ? '. Retried once after the first try timed out' : ''}`,
          tokens: usage.total_tokens,
          cost,
        },
      ],
    }
    return json(response, 200, guard.headers)
  } catch (err) {
    console.error(`Judge failed: ${errorName(err)}`)
    return json({ error: SERVER_ERROR }, 500, guard.headers)
  }
}

interface Billed {
  usage?: Usage
  cost?: Cost | null
  notReported: number
}

function failure(
  reason: string,
  model: string | null,
  latencyMs: number,
  record: { newestModel: string | null; modelCheck: ModelCheck | null },
  billed: Billed,
): JudgeResponse {
  return {
    ok: false,
    reason,
    model,
    latencyMs,
    ...billed,
    ...record,
    trace: [{ name: 'Judge', status: 'failed', ms: latencyMs, detail: reason, tokens: billed.usage?.total_tokens ?? null, cost: billed.cost ?? null }],
  }
}
