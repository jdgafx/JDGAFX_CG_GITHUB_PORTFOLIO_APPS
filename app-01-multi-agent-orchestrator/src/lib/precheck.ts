import type { AuditClaim } from '../types'
import { namesIn, numbersIn, plainText } from './audit'

export interface PreLine {
  label: string
  value: string
  /** False when the pre-pass found something the source does not contain. */
  ok: boolean
}

/** The pre-pass of a claim in words: shared content words, numbers and names, each with what was missing. */
export function preLines(claim: AuditClaim): PreLine[] {
  const plain = plainText(claim.text)
  const numbers = numbersIn(plain)
  const names = namesIn(plain)
  const { pre } = claim
  return [
    {
      label: 'Words shared',
      value: pre.best === null ? 'The cited source is not in the list.' : `${Math.round(pre.overlap * 100)}% of the sentence's content words are in the cited text`,
      ok: pre.level !== 'fail',
    },
    {
      label: 'Numbers',
      value: numbers.length === 0 ? 'None in the sentence' : pre.missingNumbers.length === 0 ? `All ${numbers.length} found` : `Not in the source: ${pre.missingNumbers.join(', ')}`,
      ok: pre.missingNumbers.length === 0,
    },
    {
      label: 'Names',
      value: names.length === 0 ? 'None in the sentence' : pre.missingNames.length === 0 ? `All ${names.length} found` : `Not in the source: ${pre.missingNames.join(', ')}`,
      ok: pre.missingNames.length === 0,
    },
  ]
}

/** A source text cut into plain and marked runs. Joined, the runs give back the text exactly. Overlapping spans are merged. */
export function markedRuns(text: string, spans: Array<{ start: number; end: number }>): Array<{ text: string; hit: boolean }> {
  const merged: Array<{ start: number; end: number }> = []
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }
  const runs: Array<{ text: string; hit: boolean }> = []
  let at = 0
  for (const span of merged) {
    runs.push({ text: text.slice(at, span.start), hit: false }, { text: text.slice(span.start, span.end), hit: true })
    at = span.end
  }
  runs.push({ text: text.slice(at), hit: false })
  return runs.filter(run => run.text !== '')
}
