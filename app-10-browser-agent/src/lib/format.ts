/** A byte count as plain text: bytes below 1 KB, then KB with one decimal. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/** A URL cut in the middle when it is long, so the host and the end of the path both stay visible. */
export function middleTruncate(text: string, max = 64): string {
  if (text.length <= max) return text
  const keep = max - 1
  const head = Math.ceil(keep * 0.6)
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`
}
