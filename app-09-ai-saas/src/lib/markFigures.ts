/** A stretch of answer text, flagged when the figure check could not find it in the evidence. */
export interface Marked {
  text: string
  flagged: boolean
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Splits `text` so every written occurrence of a figure the check rejected is its own flagged piece. `figures` are the
 * strings the server lists as not in the evidence; a trailing "(direction does not match)" is dropped so the figure itself
 * is found. A figure is not found inside a longer number. The same text elsewhere in the answer is flagged too: the
 * server lists the rejected figures by their text, not by position.
 */
export function markFigures(text: string, figures: string[]): Marked[] {
  const wanted = [...new Set(figures.map((f) => f.replace(/ \(direction does not match\)$/, '').trim()).filter((f) => f !== ''))]
  if (wanted.length === 0) return [{ text, flagged: false }]
  const pattern = new RegExp(`(?<![\\d.,])(?:${wanted.sort((a, b) => b.length - a.length).map(escape).join('|')})(?!\\d)`, 'g')
  const pieces: Marked[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) pieces.push({ text: text.slice(last, at), flagged: false })
    pieces.push({ text: match[0], flagged: true })
    last = at + match[0].length
  }
  if (last < text.length) pieces.push({ text: text.slice(last), flagged: false })
  return pieces.length > 0 ? pieces : [{ text, flagged: false }]
}
