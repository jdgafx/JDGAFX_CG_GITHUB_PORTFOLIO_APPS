import type { SourceView } from './events'

/** A page the agent read. `n` is its source number: the order it was first read, one per URL. */
export interface Evidence {
  n: number
  title: string
  url: string
  extract: string
}

/** The source numbers an answer cites, in ascending order, each once. */
export function citedNumbers(answer: string): number[] {
  const numbers = new Set<number>()
  for (const match of answer.matchAll(/\[(\d{1,3})\]/g)) numbers.add(Number(match[1]))
  return [...numbers].sort((a, b) => a - b)
}

/** Removes citation markers that name no source, so an answer never points at nothing. */
export function sanitizeCitations(answer: string, evidence: Evidence[]): string {
  const valid = new Set(evidence.map((item) => item.n))
  return answer
    .replace(/ ?\[(\d{1,3})\]/g, (marker: string, digits: string) => (valid.has(Number(digits)) ? marker : ''))
    .replace(/ +\n/g, '\n')
    .trim()
}

/** The sources an answer cites, in source-number order. */
export function sourcesFor(answer: string, evidence: Evidence[]): SourceView[] {
  const cited = new Set(citedNumbers(answer))
  return evidence
    .filter((item) => cited.has(item.n))
    .sort((a, b) => a.n - b.n)
    .map(({ n, title, url }) => ({ n, title, url }))
}
