import { readFileSync } from 'node:fs'
import { parsePriceBook, type PriceBook } from '../../netlify/shared/pricing'

/**
 * A recorded copy of OpenRouter's public model list (GET https://openrouter.ai/api/v1/models, 2026-10-10),
 * cut to four entries, each as OpenRouter sent it: Haiku 5.5, the Haiku alias, Haiku 4.5 and a router entry
 * whose price is -1. It is a test fixture only; the app has no copy of any price.
 */
export const modelListJson: unknown = JSON.parse(
  readFileSync(new URL('../fixtures/openrouter-models.json', import.meta.url), 'utf8'),
) as unknown

export function fixturePriceBook(): PriceBook {
  const book = parsePriceBook(modelListJson)
  if (!book) throw new Error('The recorded model list has no usable price.')
  return book
}
