/** Elapsed time as the page prints it everywhere, running or finished: "11,200 ms". */
export function milliseconds(ms: number): string {
  return `${Math.round(ms).toLocaleString('en-US')} ms`
}

/** The model id without its provider prefix: "anthropic/claude-haiku-5.5" shows as "claude-haiku-5.5". */
export function shortModel(id: string): string {
  return id.includes('/') ? id.slice(id.indexOf('/') + 1) : id
}
