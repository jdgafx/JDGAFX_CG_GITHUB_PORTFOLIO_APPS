import { randomUUID } from 'node:crypto'
import { MODEL, SLOTS, type CompareResponse, type PanelResult } from '../shared/contract'
import { acceptedIds, liveModels } from '../shared/catalogue'
import { gate, json, readJson } from '../shared/guard'
import { summarise } from '../shared/measure'
import { providerKey } from '../shared/openrouter'
import { failedPanel, panelStep, runPanel } from '../shared/panel'
import { parseCompare } from '../shared/validate'

export const config = { path: '/api/compare' }

export default async (req: Request): Promise<Response> => {
  const guard = gate(req, 'POST')
  if (!guard.ok) return guard.response

  const parsed = parseCompare(await readJson(req))
  if (!parsed.ok) return json({ error: parsed.error }, 400, guard.headers)
  const key = providerKey()
  if (!key) return json({ error: 'The server is missing its provider key' }, 503, guard.headers)

  const { prompt, system, temperature } = parsed.value
  const prices = await liveModels()
  const accepted = acceptedIds(prices)
  const [, modelB, modelC] = parsed.value.models
  for (const id of [modelB, modelC]) {
    if (!accepted.has(id)) return json({ error: `Model not in the live catalogue: ${id.slice(0, 120)}` }, 400, guard.headers)
  }

  // models[0] is ignored. Panel A always runs the fixed default alias.
  const models = [MODEL, modelB, modelC]
  const started = Date.now()
  const outcomes = await Promise.allSettled(
    SLOTS.map((slot, i) => runPanel({ key, slot, model: models[i], prompt, system, temperature, prices })),
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
}
