/** Elapsed time as the page prints it: "1,234 ms" under ten seconds, "12.3 s" above. */
export function milliseconds(ms: number): string {
  return ms < 10_000 ? `${Math.round(ms).toLocaleString('en-US')} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** The model id without its provider prefix: "anthropic/claude-haiku-5.5" shows as "claude-haiku-5.5". */
export function shortModel(id: string): string {
  return id.includes('/') ? id.slice(id.indexOf('/') + 1) : id
}
