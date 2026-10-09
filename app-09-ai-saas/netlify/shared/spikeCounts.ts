import type { Summary } from './contract'
import { mentionsIn, segmentsOf } from './attribution'

/**
 * Counts of unusual days written in an explanation. One shape is checked: a number directly before "unusual days",
 * "spikes" or "spike days" (with an optional "with a release" or "no release" right after it), in a clause that names
 * exactly one package or says "in total". Every other count, such as "N of the M", "the remaining N", a count of packages
 * or a count without a clear owner, is shown as unchecked and never rejected.
 */

export interface Counted {
  value: number
  text: string
  index: number
}

const UNITS: Record<string, number> = Object.fromEntries(
  ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'].map((word, i) => [word, i]),
)
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50 }
const WORD_PATTERN = [...Object.keys(UNITS), ...Object.keys(TENS)].sort((a, b) => b.length - a.length).join('|')

/** The small whole numbers written in `text`, as digits (not part of a longer run, decimal, date, version or percentage) or number words ("twenty-five", "twenty eight"). */
export function numberTokens(text: string): Counted[] {
  const found: Counted[] = []
  const pattern = new RegExp(`(?<![\\d.,/:-])(\\d{1,3})(?![\\d.,/:%-]\\d?)(?!\\s?%)|\\b(${WORD_PATTERN})(?:[-\\s]+(one|two|three|four|five|six|seven|eight|nine)\\b)?`, 'gi')
  for (const m of text.matchAll(pattern)) {
    if (m[1] !== undefined) found.push({ value: Number(m[1]), text: m[1], index: m.index ?? 0 })
    else {
      const base = m[2].toLowerCase()
      const compound = TENS[base] !== undefined && m[3] !== undefined
      found.push({ value: (TENS[base] ?? UNITS[base]) + (compound ? UNITS[m[3].toLowerCase()] : 0), text: compound ? m[0] : m[2], index: m.index ?? 0 })
    }
  }
  return found
}

const NUMBER = `(?:(\\d{1,3})(?![\\d.,/:%-]\\d?)|\\b(${WORD_PATTERN})(?:[-\\s]+(?:one|two|three|four|five|six|seven|eight|nine)\\b)?)`
/** A number, then (an adjective and) the noun. "30 days" alone is a window length, not a count of unusual days. */
const PHRASE = new RegExp(
  `(?<![\\d.,/:-])${NUMBER}\\s+(?:(unusual(?:ly high)?|notable|outlier|spike)\\s+)?(days?|spikes?)\\b` +
    `(?:\\s+(?:with(?:out)?|had|have|has|followed|follow|follows)\\s+(?:(?:a|an|no|at least one|the)\\s+)?(?:stable\\s+)?releases?)?`,
  'gi',
)
const STAND_OUT = /(?<![\d.,/:-])(\d{1,3})\s+days?\s+(?:stand|stood)s?\s+out\b/gi

export type Qualifier = 'with' | 'without' | null
const qualifierOf = (phrase: string): Qualifier => (/\b(?:no|without)\s+(?:a\s+|any\s+)?(?:stable\s+)?release/i.test(phrase) ? 'without' : /\breleases?\b/i.test(phrase) ? 'with' : null)

/** Anything that makes a count not a plain count of a package's (or all) unusual days. Read over the whole sentence. */
const NOT_PLAIN = /\b(?:of (?:the|its|their|these|those|them|[\w@/.-]+'s)|remaining|rest|others?|more|further|among|only|another|packages?|respectively|between them|both|each|all (?:three|four|five)|at least|about|roughly|around|approximately|nearly|almost)\b/i
const TOTAL_WORDS = /\b(?:in total|in all|altogether|across all)\b/i
const PRONOUN_CLAUSE = /^\W*(?:it|its|this|that|they|their|the (?:package|library))\b/i

export interface WrittenCount {
  count: Counted
  /** The packages are named so that this count can be checked: the package it is about (null for all), or unchecked when absent. */
  scope: { package: string | null } | null
  qualifier: Qualifier
  /** The sentence it is in. */
  sentence: string
}

/** Every count of unusual days written in `text`, with whether it is of the one checkable shape. */
export function scanSpikeCounts(text: string, names: string[]): WrittenCount[] {
  const found: WrittenCount[] = []
  const seen = new Set<number>()
  const segments = segmentsOf(text)
  const sentenceAround = (at: number) => {
    const from = Math.max(text.lastIndexOf('.', at - 1) + 1, text.lastIndexOf('!', at - 1) + 1, text.lastIndexOf('?', at - 1) + 1, text.lastIndexOf('\n', at - 1) + 1)
    const rest = text.slice(at).search(/[.!?\n]/)
    return text.slice(from, rest < 0 ? text.length : at + rest)
  }
  for (const m of text.matchAll(PHRASE)) {
    const numberText = m[1] ?? m[0].slice(0, m[0].search(/\s+(?:unusual|notable|outlier|spike|days?|spikes?)\b/i))
    const adjective = m[3]
    const noun = (m[4] ?? '').toLowerCase()
    if (!adjective && noun.startsWith('day')) continue // "30 days"
    const at = m.index ?? 0
    const value = m[1] !== undefined ? Number(m[1]) : numberTokens(numberText)[0]?.value
    if (value === undefined) continue
    seen.add(at)
    const count: Counted = { value, text: numberText.trim(), index: at }
    const sentence = sentenceAround(at)
    const seg = segments.find((s) => at >= s.start && at <= s.end) ?? segments[0]
    const clause = text.slice(seg.start, seg.end)
    const named = [...new Set(mentionsIn(text, names, seg.start, seg.end).map((x) => x.name))]
    let scope: WrittenCount['scope'] = null
    const plain = !NOT_PLAIN.test(sentence) && !PRONOUN_CLAUSE.test(clause)
    if (plain) {
      if (named.length === 1) scope = { package: named[0] }
      else if (named.length === 0 && TOTAL_WORDS.test(sentence)) scope = { package: null }
    }
    found.push({ count, scope, qualifier: qualifierOf(m[0]), sentence })
  }
  for (const m of text.matchAll(STAND_OUT)) {
    if (seen.has(m.index ?? 0)) continue
    found.push({ count: { value: Number(m[1]), text: m[1], index: m.index ?? 0 }, scope: null, qualifier: null, sentence: m[0] })
  }
  return found
}

/**
 * Judges a checkable count against the number the detector found (not the capped list). A count of only the days with or
 * without a release can be told only from the list, so it is unchecked when the list is capped. A count equal to the
 * listed number but not the found number is unchecked too: it is what the page lists, not what was found.
 */
export function judgeSpikeCount(written: WrittenCount, s: Summary): 'matched' | 'rejected' | 'unchecked' {
  if (!written.scope) return 'unchecked'
  const pkg = written.scope.package
  const names = pkg === null ? s.packages.map((p) => p.name) : [pkg]
  const listed = (s.spikes ?? []).filter((spike) => pkg === null || spike.name === pkg)
  const found = s.spikeCounts ? names.reduce((sum, name) => sum + (s.spikeCounts?.[name] ?? 0), 0) : listed.length
  const capped = found > listed.length
  const { value } = written.count
  if (written.qualifier === null) {
    if (value === found) return 'matched'
    return capped && value === listed.length ? 'unchecked' : 'rejected'
  }
  if (capped) return 'unchecked'
  const subset = written.qualifier === 'with' ? listed.filter((spike) => spike.releases.length > 0) : listed.filter((spike) => spike.releasesKnown && spike.releases.length === 0)
  return value === subset.length ? 'matched' : 'rejected'
}
