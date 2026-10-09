import type { Evidence } from '../citations'
import { clipText, type CriticIssue } from './parse'

/**
 * A check made in code, with no model, on answers to "how many years apart" questions. A model can
 * subtract correctly from the wrong year: a building "constructed between 1930 and 1931" was
 * completed in 1931, and 1931 minus 1889 is 42, not the 41 that 1930 minus 1889 gives.
 */
const ASKS_FOR_A_GAP = /\bhow many (?:years|decades)\b|\byears? (?:apart|between|before|after)\b/i
const YEAR = /\b(1\d{3}|20\d{2})\b/g
const YEARS_CLAIM = /\b(\d{1,3}) years?\b/

/** The years a sentence names, each once, in the order written. */
function yearsIn(text: string): number[] {
  return [...new Set([...text.matchAll(YEAR)].map((match) => Number(match[1])))]
}

/** Every "A to B", "A-B" or "between A and B" the sources give, as [A, B] with B after A. */
function rangesIn(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const match of text.matchAll(/\b(1\d{3}|20\d{2})\s*(?:to|until|[-–—])\s*(1\d{3}|20\d{2})\b/gi)) {
    ranges.push([Number(match[1]), Number(match[2])])
  }
  for (const match of text.matchAll(/\bbetween\s+(1\d{3}|20\d{2})\s+and\s+(1\d{3}|20\d{2})\b/gi)) {
    ranges.push([Number(match[1]), Number(match[2])])
  }
  return ranges.filter(([from, to]) => to > from)
}

/**
 * The problems with the year gap an answer states, each quoting the sentence that states it. The
 * gap must equal the difference of two years the sentence (or the answer) names, each year must be in
 * the sources, and a year taken from the start of a range the sources give is flagged: the gap
 * between two events runs to the year each one was completed. Empty when the question asks for no gap.
 */
export function yearGapIssues(question: string, answer: string, evidence: Evidence[]): CriticIssue[] {
  if (!ASKS_FOR_A_GAP.test(question)) return []
  const sentences = answer.split(/\n|(?<=[.!?])\s+/).filter((sentence) => sentence.trim() !== '')
  const claimed = sentences.find((sentence) => YEARS_CLAIM.test(sentence) && /\b(?:apart|between|before|after|gap|difference|minus)\b/i.test(sentence))
  if (claimed === undefined) return []
  const gap = Number(YEARS_CLAIM.exec(claimed)?.[1])
  const named = yearsIn(claimed)
  const pool = named.length >= 2 ? named : yearsIn(answer)
  if (pool.length < 2) return []
  const pair = pool.flatMap((a) => pool.filter((b) => b > a && b - a === gap).map((b): [number, number] => [a, b]))[0]
  const quote = claimed.trim()

  if (pair === undefined) {
    const spread = Math.max(...pool) - Math.min(...pool)
    return [{ quote, fix: `The years named differ by ${spread}, not ${gap}. Work the gap out from the year each event was completed.` }]
  }

  const texts = evidence.map((item) => item.extract)
  const issues: CriticIssue[] = []
  for (const year of pair) {
    if (!texts.some((text) => yearsIn(text).includes(year))) {
      issues.push({ quote, fix: `${year} is not in the sources. Use the years the sources give.` })
    }
  }
  const ranges = texts.flatMap(rangesIn)
  for (const year of pair) {
    const range = ranges.find(([from, to]) => from === year && !(pair[0] === from && pair[1] === to))
    if (range) {
      issues.push({
        quote,
        fix: `The sources give ${range[0]} to ${range[1]}, so ${range[0]} is when it began. Use ${range[1]}, when it was completed, and work the gap out again.`,
      })
    }
  }
  return issues.slice(0, 3).map((issue) => ({ ...issue, fix: clipText(issue.fix, 200) }))
}
