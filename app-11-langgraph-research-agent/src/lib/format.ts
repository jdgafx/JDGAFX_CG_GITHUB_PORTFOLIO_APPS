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
export function costHint(totals: Pick<Totals, 'cost' | 'unpricedRows'> & Partial<Pick<Totals, 'unreportedCalls' | 'refusedCalls'>>, models: readonly string[]): string {
  if (totals.cost === undefined) return 'tokens shown, no price'
  const source = `OpenRouter price for ${models.map(plainModel).join(', ')}`
  const notes = [
    totals.unpricedRows > 0 ? `${totals.unpricedRows} ${totals.unpricedRows === 1 ? 'row' : 'rows'} without a price` : '',
    notReported(totals.unreportedCalls ?? 0),
  ].filter(Boolean)
  const refused = totals.refusedCalls ?? 0
  const includes = refused > 0 ? `includes the cost of ${refused === 1 ? 'a refused call' : `${refused} refused calls`}, ` : ''
  return `${notes.length > 0 ? `partial (${notes.join(', ')}), ` : ''}${includes}${source}`
}

/** "2 calls not reported", or an empty string when every call reported. */
export const notReported = (calls: number): string => (calls > 0 ? `${calls} ${calls === 1 ? 'call' : 'calls'} not reported` : '')

/** A run total from billed calls. When some calls never reported, the figure is a floor and says so. */
export const atLeast = (value: string, calls: number): string => (calls > 0 ? `at least ${value}` : value)
