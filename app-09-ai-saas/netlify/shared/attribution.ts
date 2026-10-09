/**
 * Who a written figure is about. One resolver serves every check, so a figure is attributed the same way whether a claim
 * names its package or not. The owner is the package named in the figure's clause (the nearest one before it, or one that
 * the words "for", "of" or "from" tie to it after it). A clause that names none carries the package of the nearest earlier
 * clause in the same paragraph, but only when that clause names exactly one. Anything else has no owner, and a figure with
 * no owner may only be matched against values that belong to no single package.
 */

/** Package names that are ordinary English words. They count as a mention only in the form the package is written ("Next", "Next.js"). */
const ENGLISH_WORD_NAMES = new Set(['next', 'express', 'request', 'debug'])

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A clause that starts with one of these is about the package the clause before it was about. */
export const PRONOUN_START_RE = /^\W*(?:it|its|this|that|they|their|the (?:package|library))\b/i

export interface Mention {
  name: string
  at: number
  end: number
}

const bareName = (name: string): string => name.split('/').pop() ?? name
const wordsOf = (value: string): string[] => value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4)

/**
 * The ways a package is named in prose: its full name; the name after its scope ("the SDK" for @anthropic-ai/sdk); and a
 * word of four letters or more in it ("anthropic"). An alias that another selected package shares, or that equals another
 * package's full name, names none of them. An English-word package ("next") is named only as "Next" or "Next.js".
 */
function patternsFor(name: string, names: string[]): RegExp[] {
  const others = names.filter((other) => other !== name)
  const taken = new Set(others.flatMap((other) => [other.toLowerCase(), bareName(other).toLowerCase(), ...wordsOf(other)]))
  const word = (alias: string) => new RegExp(`(?<![\\w@/.-])${escapeRe(alias)}(?![\\w-])`, 'gi')
  const bare = bareName(name)
  if (name.toLowerCase() === 'next') {
    // "next" is also an everyday word. It names the package unless a determiner comes before it or a time or ordinal noun after it.
    return [
      /(?<![\w@/.-])(?<!\b(?:the|a|in|on|this|that|our|your|their|over|during|within|until)\s+)next(?:\.js)?(?![\w-])(?!\s+(?:month|week|year|day|days|few|step|steps|release|releases|version|section|quarter|time|one|ones|two|three|\d))/gi,
    ]
  }
  if (ENGLISH_WORD_NAMES.has(name.toLowerCase())) {
    const capital = name.charAt(0).toUpperCase() + name.slice(1)
    return [new RegExp(`(?<![\\w@/.-])${escapeRe(capital)}(?:\\.js)?(?![\\w-])`, 'g'), new RegExp(`(?<![\\w@/.-])${escapeRe(name)}\\.js(?![\\w-])`, 'gi')]
  }
  const aliases = new Set<string>([name])
  if (bare !== name && !taken.has(bare.toLowerCase()) && !ENGLISH_WORD_NAMES.has(bare.toLowerCase())) aliases.add(bare)
  for (const w of wordsOf(name)) if (!taken.has(w) && !ENGLISH_WORD_NAMES.has(w)) aliases.add(w)
  // A long run-together word ("modelcontextprotocol") is also written as spaced words ("Model Context Protocol").
  const spaced = [...aliases].filter((alias) => alias.length >= 12 && !/[^a-z0-9]/i.test(alias)).map((alias) => new RegExp(`(?<![\\w@/.-])${[...alias].map(escapeRe).join('\\s*')}(?![\\w-])`, 'gi'))
  return [...[...aliases].map(word), ...spaced]
}

/** Every place a selected package is named in `text`, in order. */
export function mentionsIn(text: string, names: string[], from = 0, to = text.length): Mention[] {
  const region = text.slice(from, to)
  const found: Mention[] = []
  for (const name of names) {
    for (const pattern of patternsFor(name, names)) {
      for (const match of region.matchAll(pattern)) found.push({ name, at: from + (match.index ?? 0), end: from + (match.index ?? 0) + match[0].length })
    }
  }
  return found.sort((a, b) => a.at - b.at)
}

export interface Segment {
  start: number
  end: number
  paragraph: number
}

/** The clauses of `text`: split at . ! ? ; : and line breaks. A blank line starts a new paragraph. */
export function segmentsOf(text: string): Segment[] {
  const breaks = [...text.matchAll(/\n[ \t]*\n/g)].map((m) => (m.index ?? 0) + m[0].length)
  const paragraphAt = (pos: number) => breaks.filter((b) => b <= pos).length
  const segments: Segment[] = []
  let start = 0
  for (const m of text.matchAll(/[;:!?\n]|\.(?=\s|$)/g)) {
    segments.push({ start, end: m.index ?? 0, paragraph: paragraphAt(start) })
    start = (m.index ?? 0) + 1
  }
  segments.push({ start, end: text.length, paragraph: paragraphAt(start) })
  return segments
}

const REACH = 4
/** The words that tie a package to the figure just before it, with no punctuation between: "834.2 million for the SDK". */
const TIES = /^[\w\s'%]{0,30}\b(?:for|from)\s+(?:the\s+)?$/i

export interface Context {
  /** The package the figure is about, or null when the text names none that resolve to one. */
  owner: string | null
  /** Packages named in the figure's own clause. */
  named: string[]
  /** Packages the clause carries from the nearest earlier clause that names any, in the same paragraph. */
  carried: string[]
  /** The first of those. */
  subject: string | null
  /** True when the clause opens with a pronoun. */
  pronoun: boolean
  /** The clause's own words. */
  clause: string
}

/** Resolves the context of the figure written at `index` .. `end` of `text`. */
export function contextOf(text: string, index: number, end: number, names: string[]): Context {
  const segments = segmentsOf(text)
  const at = Math.max(0, segments.findIndex((s) => index >= s.start && index <= s.end))
  const seg = segments[at]
  const own = mentionsIn(text, names, seg.start, seg.end)
  const named = [...new Set(own.map((m) => m.name))]
  let carried: string[] = []
  for (let back = at - 1; back >= Math.max(0, at - REACH); back--) {
    if (segments[back].paragraph !== seg.paragraph) break
    const earlier = mentionsIn(text, names, segments[back].start, segments[back].end)
    if (earlier.length > 0) {
      carried = [...new Set(earlier.map((m) => m.name))]
      break
    }
  }
  const subject = carried[0] ?? null
  const pronoun = PRONOUN_START_RE.test(text.slice(seg.start, seg.end))

  let owner: string | null = null
  if (pronoun && carried.length === 1) owner = carried[0]
  else if (own.length > 0) {
    const before = own.filter((m) => m.at < index)
    const tied = own.find((m) => m.at >= end && m.at - end <= 36 && TIES.test(text.slice(end, m.at)))
    owner = tied?.name ?? before[before.length - 1]?.name ?? own[0].name
  } else if (carried.length === 1) owner = carried[0]
  return { owner, named, carried, subject, pronoun, clause: text.slice(seg.start, seg.end) }
}

export type Metric = 'total' | 'per_day' | 'share' | 'change' | 'weekend' | 'spike_day' | 'baseline' | 'spike_pct'

/**
 * The metric a figure's words say it is, read from the words around it inside its clause and between its neighbouring
 * figures ("in total", "per day", "usual", "share", "weekend"). Null when the words say nothing.
 */
export function metricOf(text: string, from: number, index: number, end: number, to: number, unit: 'count' | '%'): Metric | null {
  const after = text.slice(end, to)
  const before = text.slice(from, index)
  const both = `${before} ${after}`
  if (unit === 'count') {
    if (/\b(?:per|a|each|every)[\s-]day\b|\bdaily\b/i.test(both)) return 'per_day'
    if (/\b(?:usual|baseline|typical|normal)\b/i.test(both)) return 'baseline'
    if (/\b(?:in total|totals?|overall|combined|altogether)\b|\bover the (?:window|period|year|\d+[- ]day)|\bin the window\b/i.test(both)) return 'total'
    if (/\b(?:spike|unusual|stood out|stands out|peaked?)\b|\bon (?:\d{4}-\d{2}-\d{2}|[A-Z][a-z]+ \d{1,2})/i.test(before)) return 'spike_day'
    return null
  }
  if (/\b(?:above|over|higher than|more than|against)\s+(?:the\s+|its\s+|their\s+)?(?:usual|baseline|typical)\b|\bspike/i.test(both)) return 'spike_pct'
  if (/\bweekend|\bweekday/i.test(both)) return 'weekend'
  if (/\bshare\b|\bof the (?:selection|total)\b|\bof (?:all |the )?(?:combined |selection's )?downloads/i.test(both)) return 'share'
  if (/\b(?:grew|grow\w*|growth|rose|rise|rising|fell|fall\w*|drop\w*|declin\w*|change|increase\w*|gain\w*|jump\w*)\b/i.test(both)) return 'change'
  return null
}

/** Where a clause of a sentence ends: a comma, bracket, break, or a linking word between two things being said. */
const DELIMITER = /[,;:.!?\n()]|\s(?:and|while|but|with|vs\.?|versus|against|compared|whereas)\s/gi

/** The span of words that belong to the figure at `index` .. `end`: after the nearest delimiter before it, up to the nearest after it. */
export function wordsOfFigure(text: string, index: number, end: number): { from: number; to: number } {
  const before = text.slice(Math.max(0, index - 60), index)
  let cut = 0
  for (const m of before.matchAll(DELIMITER)) cut = (m.index ?? 0) + m[0].length
  const from = Math.max(0, index - 60) + cut
  const rest = text.slice(end, end + 80)
  const next = rest.search(new RegExp(DELIMITER.source, 'i'))
  return { from, to: next < 0 ? Math.min(text.length, end + 80) : end + next }
}

/** Words that say a figure is about the whole selection, not one package. */
export const SELECTION_WORDS = /\b(?:together|combined|altogether|overall|the selection|all (?:the |of the )?(?:packages|three|four|five|selected)|across (?:the |all )|in all|the (?:three|four|five) (?:packages|together))\b/i
