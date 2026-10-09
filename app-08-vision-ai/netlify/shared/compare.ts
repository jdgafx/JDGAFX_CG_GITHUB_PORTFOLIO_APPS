// The comparison reply is written under three fixed headings so the page can lay it out in columns and the
// server can check that all three parts arrived. Pure text in, plain objects out: the browser imports it too.

export interface Comparison {
  similarities: string[]
  differences: string[]
  verdict: string
}

type Section = keyof Comparison

const HEADING = /^\s*(?:#{1,4}\s*|\*\*|__)?\s*(similarities|differences|verdict)\b[\s*_:]*$/i
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/

/**
 * Splits a reply into its three parts. Works on a partial reply while it streams: a section that has not
 * started yet is simply empty. Bullet lines become list items; the verdict keeps its lines as one paragraph.
 */
export function parseComparison(text: string): Comparison {
  const out: Comparison = { similarities: [], differences: [], verdict: '' }
  let section: Section | null = null
  for (const line of text.split('\n')) {
    const heading = HEADING.exec(line)
    if (heading) {
      section = heading[1].toLowerCase() as Section
      continue
    }
    const content = line.trim()
    if (!section || !content) continue
    if (section === 'verdict') {
      out.verdict = out.verdict ? `${out.verdict} ${content}` : content
      continue
    }
    const bullet = BULLET.exec(line)
    if (bullet) out[section].push(bullet[1])
    else if (out[section].length > 0) out[section][out[section].length - 1] += ` ${content}`
    else out[section].push(content)
  }
  return out
}

/** The names of the parts a finished comparison is still missing. Empty means it is complete. */
export function missingParts(text: string): Section[] {
  const parsed = parseComparison(text)
  const missing: Section[] = []
  if (parsed.similarities.length === 0) missing.push('similarities')
  if (parsed.differences.length === 0) missing.push('differences')
  if (!parsed.verdict) missing.push('verdict')
  return missing
}
