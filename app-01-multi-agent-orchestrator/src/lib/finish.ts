/** The only finish reasons that mean a reply ran to its end. Anything else (length, a filter, a tool call, a new reason, none) is not a finished reply. */
const FINISHED = new Set(['stop', 'end_turn'])

/**
 * True unless the reply finished. The server uses it to decide on a retry and to refuse to use the text:
 * a reply that was cut off, filtered or interrupted is never parsed, shown or passed on.
 */
export function isCutOff(finish: string | null): boolean {
  return finish === null || !FINISHED.has(finish)
}
