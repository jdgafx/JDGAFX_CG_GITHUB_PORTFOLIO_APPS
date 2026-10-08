import { JUDGE_MAX_TOKENS, MODEL, type JudgeResponse } from '../shared/contract'
import { gate, json, readJson } from '../shared/guard'
import { usageFrom } from '../shared/measure'
import { chat, providerKey, replyOf } from '../shared/openrouter'
import { strOrNull } from '../shared/parse'
import { parseJudge } from '../shared/validate'
import { judgeMessages, parseVerdict } from '../shared/verdict'

export const config = { path: '/api/judge' }

const JUDGE_TIMEOUT_MS = 20_000

export default async (req: Request): Promise<Response> => {
  const guard = gate(req, 'POST')
  if (!guard.ok) return guard.response

  const parsed = parseJudge(await readJson(req))
  if (!parsed.ok) return json({ error: parsed.error }, 400, guard.headers)
  const key = providerKey()
  if (!key) return json({ error: 'The server is missing its provider key' }, 503, guard.headers)

  const { prompt, answers } = parsed.value
  // Reasoning is off so a reasoning model cannot spend the budget and cut the JSON short.
  const result = await chat(
    key,
    {
      model: MODEL,
      messages: judgeMessages(prompt, answers),
      max_tokens: JUDGE_MAX_TOKENS,
      reasoning: { enabled: false },
    },
    JUDGE_TIMEOUT_MS,
  )
  // A judge failure is a normal result for the page, so it returns 200 with ok: false.
  if (!result.ok) return json(failure(result.error, null, result.latencyMs), 200, guard.headers)

  const served = strOrNull(result.data.model)
  const { text } = replyOf(result.data)
  if (text.trim() === '') return json(failure('The judge returned no text', served, result.latencyMs), 200, guard.headers)
  const verdict = parseVerdict(text, answers.map(answer => answer.slot))
  if (!verdict.ok) return json(failure(verdict.reason, served, result.latencyMs), 200, guard.headers)

  const { usage, cost } = usageFrom(result.data, served, null)
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
    trace: [
      {
        name: 'Judge',
        status: 'ok',
        ms: result.latencyMs,
        detail: `${served ?? 'Model not reported'} picked ${picked}`,
        tokens: usage.total_tokens,
        cost,
      },
    ],
  }
  return json(response, 200, guard.headers)
}

function failure(reason: string, model: string | null, latencyMs: number): JudgeResponse {
  return {
    ok: false,
    reason,
    model,
    latencyMs,
    trace: [{ name: 'Judge', status: 'failed', ms: latencyMs, detail: reason, tokens: null, cost: null }],
  }
}
