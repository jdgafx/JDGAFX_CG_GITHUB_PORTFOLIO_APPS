import { randomUUID } from 'node:crypto'
import { COMPARE_BODY_MAX_BYTES, MODEL, SLOTS, type CompareResponse, type PanelResult } from '../shared/contract'
import { acceptedIds, liveModels } from '../shared/catalogue'
import { gate, json, readJson, remainingMs, SERVER_ERROR } from '../shared/guard'
import { summarise } from '../shared/measure'
import { providerKey } from '../shared/openrouter'
import { failedPanel, PANEL_TIMEOUT_MS, panelStep, runPanel } from '../shared/panel'
import { errorName } from '../shared/parse'
import { parseCompare } from '../shared/validate'

export const config = { path: '/api/compare' }

const UNKNOWN_MODEL = 'That model is not in the model list. Choose another model.'

export default async (req: Request): Promise<Response> => {
  const guard = gate(req, 'POST')
  if (!guard.ok) return guard.response
  try {
    // One budget for the whole request: the catalogue lookup and every panel draw on it.
    const started = Date.now()
    const body = await readJson(req, COMPARE_BODY_MAX_BYTES)
    if (!body.ok) return json({ error: body.error }, 400, guard.headers)
    const parsed = parseCompare(body.value)
    if (!parsed.ok) return json({ error: parsed.error }, 400, guard.headers)
    const key = providerKey()
    if (!key) return json({ error: 'The server is missing its provider key' }, 503, guard.headers)

    const { prompt, system, temperature } = parsed.value
    const prices = await liveModels()
    const accepted = acceptedIds(prices)
    const [, modelB, modelC] = parsed.value.models
    if (!accepted.has(modelB) || !accepted.has(modelC)) {
      return json({ error: UNKNOWN_MODEL }, 400, guard.headers)
    }

    // models[0] is ignored. Panel A always runs the fixed default alias.
    const models = [MODEL, modelB, modelC]
    const outcomes = await Promise.allSettled(
      SLOTS.map((slot, i) =>
        runPanel({
          key,
          slot,
          model: models[i],
          prompt,
          system,
          temperature,
          prices,
          timeoutMs: Math.min(PANEL_TIMEOUT_MS, remainingMs(started)),
          signal: req.signal,
        }),
      ),
    )
    const panels: PanelResult[] = outcomes.map((outcome, i) =>
      outcome.status === 'fulfilled' ? outcome.value : failedPanel(SLOTS[i], models[i]),
    )
    const response: CompareResponse = {
      runId: randomUUID(),
      totalMs: Date.now() - started,
      panels,
      trace: panels.map(panelStep),
      summary: summarise(panels),
    }
    return json(response, 200, guard.headers)
  } catch (err) {
    console.error(`Compare failed: ${errorName(err)}`)
    return json({ error: SERVER_ERROR }, 500, guard.headers)
  }
}
