/**
 * A chart title in sentence case. Models like "Total Precipitation by Month"; the page's copy rule is
 * "Total precipitation by month". Only a title that is really Title Case is touched, and words that are
 * acronyms, hold digits or name a group on the chart (Alaska, Tokyo) keep their capitals.
 */
export function sentenceCase(title: string, keep: string[] = []): string {
  const words = title.split(' ')
  const long = words.filter((word) => word.replace(/[^A-Za-z]/g, '').length > 3)
  if (long.length < 2 || !long.every((word) => /^[^A-Za-z]*[A-Z]/.test(word))) return title
  const names = new Set(keep.map((name) => name.toLowerCase()))
  return words
    .map((word, index) => {
      const letters = word.replace(/[^A-Za-z]/g, '')
      if (index === 0 || letters.length < 2 && !/^[A-Z]$/.test(letters)) return word
      if (/\d/.test(word) || (letters.length > 1 && letters === letters.toUpperCase()) || names.has(letters.toLowerCase())) return word
      return word.replace(/[A-Z]/, (c) => c.toLowerCase())
    })
    .join(' ')
}
