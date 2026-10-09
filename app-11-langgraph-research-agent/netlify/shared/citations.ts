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

/** Wording that only a draft which has seen the reviewer's notes would use. */
const REVIEW_TALK =
  /\b(?:the|a|that|this|your) (?:reviewers?|critics?)\b|\b(?:reviewer|critic)['’]s\b|\b(?:previous|earlier|prior) draft\b|\bthe feedback\b|\bthe notes\b|\b(?:as|per) (?:requested|instructed)\b|\b(?:the|your|my|given) (?:guidance|instructions?)\b|\bI (?:can't|can’t|cannot) (?:quote|share|reveal)\b/i

/**
 * Removes the sentences of a revised answer that talk about the review itself. The draft prompt forbids
 * them, and this is the check behind it. An answer that is nothing but such talk is kept whole, and the
 * count says how many sentences would have gone.
 */
export function removeReviewTalk(answer: string): { text: string; removed: number } {
  let removed = 0
  const kept = answer.split('\n').map((line) => {
    const sentences = line.split(/(?<=[.!?])\s+/)
    const clean = sentences.filter((sentence) => !REVIEW_TALK.test(sentence))
    removed += sentences.length - clean.length
    return clean.join(' ')
  })
  const text = kept.filter((line) => line.trim() !== '').join('\n')
  return text === '' ? { text: answer, removed } : { text, removed }
}

/**
 * Removes the uncited sentences of a revised answer that state something no source gives: a sentence with no
 * [n] marker that holds a number of three digits or more, or a capitalised word not at its start, which is in
 * no source and not in the question. A revision can pull in a fact the reviewer hinted at, and without
 * a citation nothing shows where it came from. An answer left empty by this is kept whole.
 */
export function removeUncitedFacts(
  answer: string,
  evidence: Evidence[],
  question: string,
): { text: string; removed: number } {
  const known = `${evidence.map((item) => item.extract).join(' ')} ${question}`.toLowerCase()
  let removed = 0
  const kept = answer.split('\n').map((line) => {
    const sentences = line.split(/(?<=[.!?])\s+/)
    const clean = sentences.filter((sentence) => {
      if (/\[\d{1,3}\]/.test(sentence)) return true
      const words = sentence.match(/[\p{L}\p{N}'’-]+/gu) ?? []
      const claims = words.filter((word, index) => (index > 0 && /^\p{Lu}/u.test(word)) || /^\d{3,}$/.test(word))
      return claims.every((claim) => known.includes(claim.toLowerCase()))
    })
    removed += sentences.length - clean.length
    return clean.join(' ')
  })
  const text = kept.filter((line) => line.trim() !== '').join('\n')
  return text === '' ? { text: answer, removed: 0 } : { text, removed }
}

/** What a revised answer is cleaned of before it goes out: talk about the review, and uncited facts no source gives. */
export function cleanRevisedAnswer(
  draft: string,
  evidence: Evidence[],
  question: string,
): { text: string; reviewRemoved: number; factsRemoved: number } {
  const noReviewTalk = removeReviewTalk(draft)
  const noFacts = removeUncitedFacts(noReviewTalk.text, evidence, question)
  return { text: noFacts.text, reviewRemoved: noReviewTalk.removed, factsRemoved: noFacts.removed }
}
