const MIN_CHARS = 3

/** Whitespace runs become one space; `map[i]` is where character i of the result starts in the original. */
function squash(text: string): { text: string; map: number[] } {
  let out = ''
  const map: number[] = []
  let space = false
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i])) {
      if (!space && out !== '') {
        out += ' '
        map.push(i)
      }
      space = true
    } else {
      out += text[i]
      map.push(i)
      space = false
    }
  }
  return { text: out, map }
}

/**
 * Where `evidence` sits inside `line`, ignoring differences in spacing, as [start, end) offsets into `line`. The checks on
 * the server already found this code on the line, so this only draws it. Null when it is not there (a quote on another line).
 */
export function quoteRange(line: string, evidence: string | null): [number, number] | null {
  if (!evidence) return null
  const hay = squash(line)
  const forms = [evidence, evidence.replace(/^\d+\s*\|\s?/, ''), evidence.replace(/^\d+\s*\|\s?/, '').replace(/^[+-]\s?/, '')]
  for (const form of forms) {
    const needle = squash(form).text.trim()
    if (needle.length < MIN_CHARS) continue
    const at = hay.text.indexOf(needle)
    if (at === -1) continue
    const last = at + needle.length - 1
    return [hay.map[at], hay.map[last] + 1]
  }
  return null
}

/** The line cut into the text before the quote, the quote, and the text after it. */
export function splitAtQuote(line: string, evidence: string | null): { before: string; quote: string; after: string } | null {
  const range = quoteRange(line, evidence)
  if (!range) return null
  return { before: line.slice(0, range[0]), quote: line.slice(range[0], range[1]), after: line.slice(range[1]) }
}
