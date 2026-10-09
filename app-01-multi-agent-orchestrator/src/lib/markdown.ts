/** One piece of an answer line: plain text, or text the model marked as emphasis, strong or code. */
export interface Inline {
  kind: 'text' | 'em' | 'strong' | 'code'
  text: string
}

/**
 * Reads the inline markdown subset a model tends to write: `**strong**`, `*emphasis*`, `_emphasis_` and `code`.
 * It returns pieces, never HTML, so the page renders them as elements and nothing in the text can inject markup.
 * A lone asterisk or underscore, and anything else (including [n] citations), stays plain text.
 */
const PATTERN = /\*\*([^*\n]+?)\*\*|\*([^*\s][^*\n]*?)\*|(?<![\w])_([^_\s][^_\n]*?)_(?![\w])|`([^`\n]+)`/g

export function parseInline(line: string): Inline[] {
  const parts: Inline[] = []
  let last = 0
  for (const match of line.matchAll(PATTERN)) {
    const at = match.index ?? 0
    if (at > last) parts.push({ kind: 'text', text: line.slice(last, at) })
    if (match[1] !== undefined) parts.push({ kind: 'strong', text: match[1] })
    else if (match[2] !== undefined) parts.push({ kind: 'em', text: match[2] })
    else if (match[3] !== undefined) parts.push({ kind: 'em', text: match[3] })
    else parts.push({ kind: 'code', text: match[4] ?? '' })
    last = at + match[0].length
  }
  if (last < line.length) parts.push({ kind: 'text', text: line.slice(last) })
  return parts.length > 0 ? parts : [{ kind: 'text', text: line }]
}
