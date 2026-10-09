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

/** Removes the leading whitespace every non-blank line has in common, so the block keeps its own structure (Python above all). */
export function dedent(lines: readonly string[]): string[] {
  const filled = lines.filter((l) => l.trim() !== '')
  if (filled.length === 0) return [...lines]
  let prefix = filled[0].match(/^[ \t]*/)![0]
  for (const l of filled) {
    let i = 0
    while (i < prefix.length && l[i] === prefix[i]) i += 1
    prefix = prefix.slice(0, i)
    if (prefix === '') break
  }
  return lines.map((l) => (l.trim() === '' ? l.replace(/^[ \t]+$/, '') : l.slice(prefix.length)))
}

export type Segment = { text: string; mark: 'evidence' | 'support' | null }

/**
 * The line cut into plain text and marked quotes: the evidence (the code the second pass relied on) and the support (the
 * code that backs the claim). Where they overlap or coincide the line carries one evidence mark. Null when neither is on it.
 */
export function markSegments(line: string, evidence: string | null, support: string | null): Segment[] | null {
  const e = quoteRange(line, evidence)
  const s = quoteRange(line, support)
  if (!e && !s) return null
  const spans: Array<[number, number, 'evidence' | 'support']> = []
  if (e) spans.push([e[0], e[1], 'evidence'])
  if (s && !(e && s[0] < e[1] && e[0] < s[1])) spans.push([s[0], s[1], 'support'])
  spans.sort((a, b) => a[0] - b[0])
  const out: Segment[] = []
  let at = 0
  for (const [from, to, mark] of spans) {
    if (from > at) out.push({ text: line.slice(at, from), mark: null })
    out.push({ text: line.slice(from, to), mark })
    at = to
  }
  if (at < line.length) out.push({ text: line.slice(at), mark: null })
  return out
}
