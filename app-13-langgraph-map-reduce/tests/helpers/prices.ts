import { readFileSync } from 'node:fs'
import { parsePriceList, type PriceList } from '../../netlify/shared/prices'

/**
 * The model id OpenRouter's list carries for Claude Haiku 5.5 when the fixture was recorded. A test constant:
 * the app never names a served model, it reads the one each reply reports.
 */
export const SERVED_MODEL = 'anthropic/claude-haiku-5.5'

/** The public list as recorded on 2026-10-10, trimmed to six entries. A test fixture only. */
export const RECORDED_LIST: unknown = JSON.parse(readFileSync('tests/fixtures/openrouter-models.json', 'utf8'))

/** The recorded list as the server reads it. */
export const recordedPrices = (): PriceList => {
  const list = parsePriceList(RECORDED_LIST)
  if (!list) throw new Error('The recorded model list is not readable.')
  return list
}

/** A fetch that answers the models URL with the recorded list. */
export const modelsResponse = (): Response => new Response(JSON.stringify(RECORDED_LIST), { status: 200, headers: { 'Content-Type': 'application/json' } })
