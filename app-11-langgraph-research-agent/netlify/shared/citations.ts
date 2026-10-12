import { NOT_CITED, type CitationStatus, type SourceView } from './events'

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

/** A sentence that ends on a one-letter abbreviation ("U.S.") has not ended: the next piece belongs to it. */
const ABBREVIATION_END = /(?:^|[\s(.])\p{Lu}\.$/u
/** Markers at the start of a piece ("[1] Next sentence", after the full stop) belong to the sentence before it. */
const LEADING_MARKERS = /^((?:\[\d{1,3}\]\s*)+)(.*)$/s

/** The sentences of one line, each trimmed. A marker that follows its full stop stays with its sentence. */
export function sentencesOf(line: string): string[] {
  const sentences: string[] = []
  for (const part of line.split(/(?<=[.!?])\s+/)) {
    let piece = part.trim()
    if (piece === '') continue
    let before = sentences[sentences.length - 1]
    if (before !== undefined) {
      const lead = LEADING_MARKERS.exec(piece)
      if (lead) {
        before = `${before} ${lead[1].trim()}`
        sentences[sentences.length - 1] = before
        piece = lead[2].trim()
        if (piece === '') continue
      }
    }
    if (before !== undefined && ABBREVIATION_END.test(before)) {
      sentences[sentences.length - 1] = `${before} ${piece}`
    } else {
      sentences.push(piece)
    }
  }
  return sentences
}

/**
 * Removes the sentences of a revised answer that talk about the review itself. The draft prompt forbids
 * them, and this is the check behind it. An answer that is nothing but such talk is kept whole, and the
 * count says how many sentences would have gone.
 */
export function removeReviewTalk(answer: string): { text: string; removed: number } {
  let removed = 0
  const kept = answer.split('\n').map((line) => {
    const sentences = sentencesOf(line)
    const clean = sentences.filter((sentence) => !REVIEW_TALK.test(sentence))
    removed += sentences.length - clean.length
    return clean.join(' ')
  })
  const text = kept.filter((line) => line.trim() !== '').join('\n')
  return text === '' ? { text: answer, removed } : { text, removed }
}

/**
 * The one citation rule, for every answer. A sentence is cited when it holds a source marker [n]; with sources
 * read, a sentence that holds none gets the tag and is listed, whatever it says. Nothing is deleted: an
 * uncited sentence stays in the answer, marked. Run it after `sanitizeCitations`, so a marker that named no
 * source no longer counts. A line with no word or number in it (a rule, a bullet) is not a sentence.
 */
export function markUncited(answer: string, evidence: Evidence[]): { text: string; status: CitationStatus } {
  const status: CitationStatus = { sentences: 0, uncited: [] }
  if (evidence.length === 0) return { text: answer, status }
  const text = answer
    .split('\n')
    .map((line) =>
      sentencesOf(line)
        .map((sentence) => {
          if (!/[\p{L}\p{N}]/u.test(sentence.replace(/\[\d{1,3}\]/g, ''))) return sentence
          status.sentences += 1
          if (/\[\d{1,3}\]/.test(sentence)) return sentence
          status.uncited.push(sentence)
          return `${sentence} ${NOT_CITED}`
        })
        .join(' '),
    )
    .join('\n')
  return { text, status }
}

/** An answer ready to show: cleaned, its citations checked, and the sources it cites. */
export interface FinishedAnswer {
  text: string
  sources: SourceView[]
  citation: CitationStatus
  /** Sentences of a revised answer that talked about the review and were removed. */
  reviewRemoved: number
}

/**
 * The one path every answer takes before it goes out, a first draft and a revision alike: a revision loses its
 * talk about the review, markers that name no source go, then each sentence is checked for a marker.
 */
export function finishAnswer(draft: string, evidence: Evidence[], revised: boolean): FinishedAnswer {
  const quiet = revised ? removeReviewTalk(draft) : { text: draft, removed: 0 }
  const sanitized = sanitizeCitations(quiet.text, evidence)
  const marked = markUncited(sanitized, evidence)
  return {
    text: marked.text,
    sources: sourcesFor(sanitized, evidence),
    citation: marked.status,
    reviewRemoved: quiet.removed,
  }
}
