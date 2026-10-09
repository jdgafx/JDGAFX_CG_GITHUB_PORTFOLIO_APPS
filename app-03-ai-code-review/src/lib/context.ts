import type { DiffUnit } from '../../netlify/shared/diff'

/** One line of the code shown around a comment. `n` is the number printed in the gutter, empty when the line has none. */
export interface ContextLine {
  text: string
  n: string
  kind: 'code' | 'add' | 'del' | 'ctx'
  cited: boolean
}

export const CONTEXT_RADIUS = 4

/** The lines around a cited line of a reviewed file, with the file's own line numbers. */
export function fileContext(lines: readonly string[], line: number, radius = CONTEXT_RADIUS): ContextLine[] {
  const from = Math.max(1, line - radius)
  const to = Math.min(lines.length, line + radius)
  const out: ContextLine[] = []
  for (let n = from; n <= to; n += 1) out.push({ text: lines[n - 1], n: String(n), kind: 'code', cited: n === line })
  return out
}

/**
 * The lines around a cited position of a reviewed pull request diff. File headers and hunk headers are left out; a line
 * is numbered by the side it is on (new for added and unchanged lines, old for removed ones).
 */
export function diffContext(units: readonly DiffUnit[], line: number, radius = CONTEXT_RADIUS): ContextLine[] {
  const from = Math.max(1, line - radius)
  const to = Math.min(units.length, line + radius)
  const out: ContextLine[] = []
  for (let n = from; n <= to; n += 1) {
    const u = units[n - 1]
    if (u.kind === 'meta') continue
    const num = u.kind === 'del' ? u.oldLine : u.newLine
    out.push({ text: u.text, n: num === null ? '' : String(num), kind: u.kind, cited: n === line })
  }
  return out
}
