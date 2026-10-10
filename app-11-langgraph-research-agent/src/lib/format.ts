import type { Totals } from '../../netlify/shared/events'

export const count = (value: number): string => value.toLocaleString('en-US')

export const milliseconds = (value: number): string => `${count(value)} ms`

/** Six decimals, because most calls cost a fraction of a cent. */
export const usd = (value: number): string => `$${value.toFixed(6)}`

/** An OpenRouter alias id starts with "~" ("~anthropic/claude-haiku-latest"). The page never shows that prefix. */
export const plainModel = (id: string): string => (id.startsWith('~') ? id.slice(1) : id)

/** A model id without its provider prefix, so a chip stays short. The full id goes in the title. */
export const shortModel = (id: string): string => {
  const plain = plainModel(id)
  return plain.slice(plain.indexOf('/') + 1)
}

export const plural = (value: number, word: string): string => `${value} ${word}${value === 1 ? '' : 's'}`

/** Why a run has no cost, from the models its replies named: none was named, or OpenRouter lists no price for the ones that were. */
export const noCostText = (models: readonly string[]): string =>
  models.length === 0 ? 'served model not reported' : 'price unavailable'

/**
 * The hint under the total cost. It says the price comes from OpenRouter and names the model that answered.
 * A total built from only some calls is labelled partial and says how many model calls have no price, so a
 * partial sum is never read as the whole cost.
 */
export function costHint(totals: Pick<Totals, 'cost' | 'unpricedRows'>, models: readonly string[]): string {
  if (totals.cost === undefined) return 'tokens shown, no price'
  const source = `OpenRouter price for ${models.map(plainModel).join(', ')}`
  if (totals.unpricedRows > 0) {
    return `partial (${totals.unpricedRows} ${totals.unpricedRows === 1 ? 'row' : 'rows'} without a price), ${source}`
  }
  return source
}
