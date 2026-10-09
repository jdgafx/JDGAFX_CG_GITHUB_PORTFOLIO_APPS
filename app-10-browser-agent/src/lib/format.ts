/** A byte count as plain text: bytes below 1 KB, then KB with one decimal. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}
