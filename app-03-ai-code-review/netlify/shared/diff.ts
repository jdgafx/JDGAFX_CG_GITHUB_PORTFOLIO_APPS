import { MAX_CODE_LENGTH } from '../../src/lib/limits'
import type { PrAccount, PrFileAccount } from '../../src/types'

/** The most characters of numbered diff one review reads. Files are included whole or not at all, never cut. */
export const MAX_DIFF_CHARS = MAX_CODE_LENGTH

/** A pull request file as the GitHub files API lists it. `patch` is absent for binary and very large diffs. */
export interface PrFileInput {
  path: string
  status: string
  patch: string | null
}

/**
 * One numbered line of the diff the reviewer reads. `text` is the code without its +, - or space, which is what a
 * quote is matched against; `shown` is the line as printed. Only add and del lines can carry a comment.
 */
export interface DiffUnit {
  text: string
  shown: string
  kind: 'meta' | 'ctx' | 'add' | 'del'
  file: string
  newLine: number | null
  oldLine: number | null
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
const GENERATED = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock)$|\.min\.(?:js|css)$|\.map$/

const unit = (u: Omit<DiffUnit, 'shown'> & { shown?: string }): DiffUnit => ({ shown: u.text, ...u })

/** The numbered lines of one file's patch, after its header line. Hunk headers are meta lines. */
export function parsePatch(file: string, patch: string): DiffUnit[] {
  const units: DiffUnit[] = []
  let oldLine = 0
  let newLine = 0
  for (const line of patch.replace(/\r\n?/g, '\n').split('\n')) {
    const hunk = HUNK.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      units.push(unit({ text: '', shown: line, kind: 'meta', file, newLine: null, oldLine: null }))
    } else if (line.startsWith('\\')) {
      continue
    } else if (line.startsWith('+')) {
      units.push(unit({ text: line.slice(1), shown: line, kind: 'add', file, newLine, oldLine: null }))
      newLine += 1
    } else if (line.startsWith('-')) {
      units.push(unit({ text: line.slice(1), shown: line, kind: 'del', file, newLine: null, oldLine }))
      oldLine += 1
    } else if (units.length > 0) {
      const text = line.startsWith(' ') ? line.slice(1) : line
      units.push(unit({ text, shown: ` ${text}`, kind: 'ctx', file, newLine, oldLine }))
      newLine += 1
      oldLine += 1
    }
  }
  // A trailing newline in the patch leaves one empty context line at the end.
  const last = units[units.length - 1]
  if (last && last.kind === 'ctx' && last.text === '' && patch.endsWith('\n')) units.pop()
  return units
}

export interface BuiltDiff {
  units: DiffUnit[]
  /** Added and removed lines. */
  changed: number
  /** Characters of numbered text, one line break per line. */
  chars: number
}

const charsOf = (units: DiffUnit[]) => units.reduce((sum, u) => sum + u.shown.length + 1, 0)
const changedOf = (units: DiffUnit[]) => units.filter((u) => u.kind === 'add' || u.kind === 'del').length

function fileUnits(file: PrFileInput): DiffUnit[] {
  const header = unit({ text: '', shown: `=== ${file.path} (${file.status})`, kind: 'meta', file: file.path, newLine: null, oldLine: null })
  return [header, ...parsePatch(file.path, file.patch ?? '')]
}

/** The numbered diff for the given files, in order. */
export function buildDiff(files: PrFileInput[]): BuiltDiff {
  const units = files.flatMap(fileUnits)
  return { units, changed: changedOf(units), chars: charsOf(units) }
}

export const isGenerated = (path: string): boolean => GENERATED.test(path)

/** Files that can be reviewed at all: they have a text patch and are not lockfiles or minified output. */
export const isReviewable = (file: PrFileInput): boolean => Boolean(file.patch && file.patch.trim()) && !isGenerated(file.path)

/** The files a review includes when the visitor changes nothing: in order, each one that still fits. */
export function defaultSelection(files: PrFileInput[], limit = MAX_DIFF_CHARS): Set<string> {
  const picked = new Set<string>()
  let used = 0
  for (const file of files) {
    if (!isReviewable(file)) continue
    const chars = charsOf(fileUnits(file))
    if (used + chars <= limit) {
      picked.add(file.path)
      used += chars
    }
  }
  return picked
}

/** Every file with its size and whether it is in the review, and the totals. Nothing is left out without a reason. */
export function accountFiles(files: PrFileInput[], selected: ReadonlySet<string>, limit = MAX_DIFF_CHARS): PrAccount {
  const rows: PrFileAccount[] = files.map((file) => {
    const units = fileUnits(file)
    const chars = charsOf(units)
    const changed = changedOf(units)
    const included = isReviewable(file) && selected.has(file.path)
    let skipped: PrFileAccount['skipped'] = null
    if (!included) {
      if (!file.patch || !file.patch.trim()) skipped = 'no-patch'
      else if (isGenerated(file.path)) skipped = 'generated'
      else if (chars > limit) skipped = 'too-large'
      else skipped = 'not-selected'
    }
    return { path: file.path, status: file.status, changed, chars, included, skipped }
  })
  const inc = rows.filter((r) => r.included)
  return {
    files: rows,
    filesIncluded: inc.length,
    filesTotal: rows.length,
    changedIncluded: inc.reduce((s, r) => s + r.changed, 0),
    charsIncluded: inc.reduce((s, r) => s + r.chars, 0),
    charLimit: limit,
  }
}
