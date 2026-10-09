export const count = (value: number): string => value.toLocaleString('en-US')

export const milliseconds = (value: number): string => `${count(value)} ms`

/** Six decimals, because most calls cost a fraction of a cent. */
export const usd = (value: number): string => `$${value.toFixed(6)}`

/** A model id without its provider prefix, so a chip stays short. The full id goes in the title. */
export const shortModel = (id: string): string => id.slice(id.indexOf('/') + 1)

/** BM25 scores are shown to two places. */
export const score = (value: number): string => value.toFixed(2)
