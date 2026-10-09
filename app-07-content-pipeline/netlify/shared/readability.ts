// Readability figures for a piece of writing. Pure and shared with the browser.
// The syllable count is a heuristic (vowel groups), so a score is a trend between versions of one
// piece, not an exact grade.

export interface Readability {
  words: number
  sentences: number
  wordsPerSentence: number
  // Flesch reading ease: higher is easier. About 60 to 70 is plain English, below 30 is dense.
  fleschEase: number
}

// What a reader sees as prose: headings, link markup, citation markers and list markers removed.
// A heading line is not a sentence, so it is dropped; a bullet is kept as one sentence.
export function proseOf(text: string): string {
  return text
    .split('\n')
    .filter(line => !/^\s{0,3}#{1,6}\s/.test(line))
    .map(line => line
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
      .replace(/\[(\d{1,2})\]/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|`|\*|_)/g, ''))
    .join('\n')
}

export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (w.length === 0) return 0
  if (w.length <= 3) return 1
  const trimmed = w.replace(/(?:[^laeiouy]es|[^aeiouytd]ed|[^laeiouy]e)$/, '').replace(/^y/, '')
  const groups = trimmed.match(/[aeiouy]+/g)
  return Math.max(1, groups?.length ?? 0)
}

export function readability(text: string): Readability | null {
  const prose = proseOf(text)
  const words = prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []
  if (words.length === 0) return null
  // Sentences end at . ! or ? followed by a space or the end; a line without an end mark is one sentence.
  const sentences = prose
    .split(/(?<=[.!?]["')\]]?)\s+|\n+/)
    .filter(part => /[\p{L}\p{N}]/u.test(part)).length
  const count = Math.max(1, sentences)
  const syllableTotal = words.reduce((sum, word) => sum + Math.max(1, syllables(word)), 0)
  const wordsPerSentence = words.length / count
  const fleschEase = 206.835 - 1.015 * wordsPerSentence - 84.6 * (syllableTotal / words.length)
  return {
    words: words.length,
    sentences: count,
    wordsPerSentence: Math.round(wordsPerSentence * 10) / 10,
    fleschEase: Math.round(fleschEase * 10) / 10,
  }
}
