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

/** A source text cut into plain and marked runs. Joined, the runs give back the text exactly. */
export function markedRuns(text: string, span: { start: number; end: number } | null): Array<{ text: string; hit: boolean }> {
  if (!span) return [{ text, hit: false }]
  return [
    { text: text.slice(0, span.start), hit: false },
    { text: text.slice(span.start, span.end), hit: true },
    { text: text.slice(span.end), hit: false },
  ].filter(run => run.text !== '')
}
