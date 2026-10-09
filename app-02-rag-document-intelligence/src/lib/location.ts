import type { DocumentState } from '../types'

type Located = Pick<DocumentState, 'unit' | 'sectionTitles'>

/** "page 4" for a PDF, "section 4: Efficiency" for a document read in sections. */
export function locationLabel(doc: Located, n: number): string {
  if (doc.unit === 'page') return `page ${n}`
  const title = doc.sectionTitles[n - 1]
  return title ? `section ${n}: ${title}` : `section ${n}`
}

/** The word for the unit, plural, capitalised for a figure label: "Pages" or "Sections". */
export function unitHeading(doc: Pick<DocumentState, 'unit'>): string {
  return doc.unit === 'page' ? 'Pages' : 'Sections'
}

/** The last part of a section path, "Calvin cycle" for "Light-independent reactions > Calvin cycle". */
function leafOf(title: string): string {
  return title.split(' > ').pop() ?? title
}

/**
 * Question openers built from a document's own section titles: one about the whole
 * document, then up to `max - 1` spread evenly over its top-level sections. They
 * fill the question box and the person still presses Ask.
 */
export function questionStarters(sectionTitles: string[], max = 4): string[] {
  const lead = sectionTitles[0]
  if (!lead) return []
  const rest = sectionTitles.slice(1)
  const topLevel = rest.filter(title => !title.includes(' > '))
  const pool = topLevel.length >= max - 1 ? topLevel : rest
  const picks = Math.min(max - 1, pool.length)
  const chosen = Array.from({ length: picks }, (_, i) => pool[Math.floor((i * pool.length) / picks)] ?? '')
  return [`What is ${lead}?`, ...chosen.map(title => `What does it say about ${leafOf(title)}?`)]
}
