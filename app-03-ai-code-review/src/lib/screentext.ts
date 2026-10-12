// The words App puts on the page that depend only on what is loaded: kept out of App so that file stays readable.
import { SEVERITY_CONFIG } from '../constants'
import type { ReviewComment, ReviewResult } from '../types'
import { count } from './format'
import { MAX_CODE_LENGTH } from './limits'
import { VERDICT_WORD } from './verdicts'

/** The line under the controls: what the next run will read, or that one is under way. */
export function statusLineFor(running: boolean, fileMode: boolean, lineCount: number, codeLength: number, filesIncluded: number | null, filesTotal: number): string {
  if (running) return 'Reviewing. Stop cancels the browser request; the provider may still bill the calls already sent.'
  if (fileMode) return `${count(lineCount)} ${lineCount === 1 ? 'line' : 'lines'}, ${count(codeLength)} of ${count(MAX_CODE_LENGTH)} characters. Ctrl or Cmd+Enter also runs the review.`
  return filesIncluded === null ? 'Load a pull request to choose its files.' : `${count(filesIncluded)} of ${count(filesTotal)} files selected. Ctrl or Cmd+Enter also runs the review.`
}

/** What the empty result says before a run. */
export function emptyBodyFor(fileMode: boolean, filesIncluded: number | null): string {
  if (fileMode) return 'Load a file from GitHub or paste code, then select Review code. Each comment comes back kept, moved or dropped, with the reason.'
  if (filesIncluded !== null && filesIncluded > 0) return `Review pull request reads the ${count(filesIncluded)} selected ${filesIncluded === 1 ? 'file' : 'files'} and returns each comment kept, moved or dropped, with the reason.`
  return 'Load a public pull request and choose its files, then select Review pull request. Each comment comes back kept, moved or dropped, with the reason.'
}

/** The review as plain text for the clipboard: a header, then each kept comment with its verdict and the check behind it. */
export function reviewAsText(result: ReviewResult, where: string, shown: ReviewComment[]): string {
  const header = `CodeLens AI verified review - ${where}, ${shown.length} comment${shown.length === 1 ? '' : 's'} kept of ${result.comments.length} from the first pass`
  const body = shown
    .map((c) => {
      const at = c.where ? `${c.where.file}:${c.where.line}` : `Line ${c.line}`
      return `[${SEVERITY_CONFIG[c.severity].label.toUpperCase()}] ${at} (${VERDICT_WORD[c.verdict].word.toLowerCase()})\n  ${c.message}\n  Suggestion: ${c.suggestion}\n  Checked: ${c.reason}`
    })
    .join('\n\n')
  return `${header}\n\n${body}\n`
}
