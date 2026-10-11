import type { ModelCheck } from '../types'

export const count = (value: number): string => value.toLocaleString('en-US')

export const milliseconds = (value: number): string => `${count(value)} ms`

/** Six decimals, because most calls cost a fraction of a cent. */
export const usd = (value: number): string => `$${value.toFixed(6)}`

/** A model id without its provider prefix, so a chip stays short. The full id goes in the title. */
export const shortModel = (id: string): string => id.slice(id.indexOf('/') + 1)

/** The marker after the served id: how it compares with the newest model. Null when no model was named. */
export const modelMarker = (check: ModelCheck): string | null =>
  check === 'match' ? '· newest' : check === 'mismatch' ? '· not newest' : check === 'unchecked' ? '· unchecked' : null

/** The full served id. When a call did not match the newest model, the title names that call's id and the newest id. */
export const modelTitle = (served: string, newest: string | null, mismatched: string | null): string =>
  mismatched !== null && newest !== null ? `${mismatched}, newest: ${newest}` : served

/** BM25 scores are shown to two places. */
export const score = (value: number): string => value.toFixed(2)
