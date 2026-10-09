export const count = (value: number): string => value.toLocaleString('en-US')
export const milliseconds = (ms: number): string => `${count(Math.round(ms))} ms`
export const usd = (cost: number): string => `$${cost.toFixed(5)}`
export const shortModel = (id: string): string => id.replace(/^anthropic\//, '')
