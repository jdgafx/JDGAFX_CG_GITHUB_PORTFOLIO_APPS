import type { ModelCheck } from '../../src/types/frames'
import { MODEL } from './models'
import type { ModelList } from './prices'

/** The newest model the list says the app's alias resolves to, or null when the list does not say. */
export function newestModel(list: ModelList | null): string | null {
  return list?.aliases.get(MODEL) ?? null
}

/**
 * Compares a call's served model with the newest model. A reply that names no model is not-reported, and the
 * requested alias never stands in for it. With no newest model to compare with, the check is unchecked.
 */
export function servedCheck(newest: string | null, served: string | null): ModelCheck {
  if (served === null) return 'not-reported'
  if (newest === null) return 'unchecked'
  return served === newest ? 'match' : 'mismatch'
}
