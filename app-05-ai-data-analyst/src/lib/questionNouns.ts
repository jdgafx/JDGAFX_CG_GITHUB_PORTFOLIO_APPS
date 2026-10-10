import type { ParsedData, PlanFilter, QueryPlan, Vocabulary } from '../types'
import { RANKED_COUNT_SOURCE } from './rankedCount'
import { labelFor, RAW_VOCABULARY } from './vocabulary'

/** The count the plan asks for when it is one total over the rows. */
export const ROWS = 'rows'

const PLAIN_NUMBER = /^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?$/

/** Words that ask for a ranking, a breakdown or a comparison, so the question wants groups. "First 3" and "last 3" rank too. */
export const GROUPING_WORDS = new RegExp(
  `\\b(by|per|each|every|which|top|bottom|most|least|fewest|highest|lowest|largest|smallest|breakdown|rank(?:ed|ing)?|compare|comparison|trend|over time|distribution)\\b|${RANKED_COUNT_SOURCE}`,
  'i',
)
/** Words that ask for one number over all the rows without naming a noun: "in total", "altogether". */
const EXPLICIT_TOTAL = /\b(in total|total number|altogether|in all|overall|all together)\b/i
const HOW_MANY = /\bhow many\b/i
/**
 * Plural words a visitor uses for the rows of any dataset, read beside the dataset's own row noun: "how many quakes
 * had magnitude 4.5 or greater?" counts the earthquakes. Plural only, so "how many earthquake types" (a group) never
 * matches a row word.
 */
export const ROW_NOUN_SYNONYMS = ['quakes', 'events', 'records', 'rows', 'items']

/** The dataset's words for the question's counting: its row noun and every column name and label. */
export interface QuestionNouns {
  /** The row noun, such as "earthquakes". The generic 'rows' when the data has no vocabulary. */
  rowNoun: string
  /** Every column name and its label. A count of one of these counts groups, not rows. */
  nouns: string[]
  /** Each column's header and label, so a noun in the question can be resolved to the column it names. */
  columns?: Array<{ header: string; label: string }>
}

export const NO_VOCABULARY: QuestionNouns = { rowNoun: RAW_VOCABULARY.rowNoun, nouns: [] }

/** Words that end a counted phrase: "how many earthquake types were there" counts "earthquake types". */
const PHRASE_END = new Set([
  'had', 'have', 'has', 'were', 'was', 'are', 'is', 'did', 'do', 'does', 'of', 'with', 'in', 'at', 'over', 'under',
  'above', 'below', 'from', 'that', 'where', 'and', 'or', 'there', 'more', 'less', 'fewer', 'total', 'all', 'overall',
  'altogether', 'the', 'for', 'on', 'by', 'per', 'each', 'every', 'which', 'this', 'last', 'today', 'yesterday',
  'since', 'during',
])
/** A past-tense verb such as "recorded" or "experienced" ends the counted phrase too, but "speed" and "feed" do not. */
const PAST_VERB = /^[a-z]{2,}[^e]ed$/

/**
 * Words that complete a threshold on a counted noun: "magnitude 5 or greater", "magnitude 4.5 or more". They sit
 * between the number and the noun that is counted, and never name a noun themselves.
 */
const THRESHOLD_WORDS = new Set(['or', 'and', 'greater', 'less', 'more', 'fewer', 'higher', 'lower', 'least', 'most', 'than', 'up', 'above', 'below'])

/**
 * The plain words of the phrase a "how many" question counts, up to the first word that ends it. A number marks a
 * threshold on the word before it ("magnitude 5 or greater earthquakes" gives "earthquakes"), so that word, the
 * column being thresholded, is dropped. The last word left is the noun counted: its head.
 */
function countedWords(question: string): string[] {
  const words: string[] = []
  let threshold = false
  for (const token of /\bhow many\s+(?:(?:distinct|different)\s+)?(.*)$/i.exec(question)?.[1]?.split(/\s+/) ?? []) {
    const word = token.replace(/[?.,!;:+]+$/, '').toLowerCase()
    if (word === '') continue
    if (PLAIN_NUMBER.test(word)) {
      words.pop()
      threshold = true
      continue
    }
    if (threshold && THRESHOLD_WORDS.has(word)) continue
    if (!/^[a-z]+$/.test(word) || PHRASE_END.has(word) || (words.length > 0 && PAST_VERB.test(word))) break
    words.push(word)
  }
  return words
}

/** Escaped text for a column name or label, matched as a singular or plural noun ("region", "regions", "countries"). */
function nounPattern(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escaped.endsWith('y') ? `${escaped.slice(0, -1)}(?:y|ies)` : `${escaped}(?:e?s)?`
}

/**
 * True when the head of the counted phrase is one of the nouns: "how many regions", "how many distinct magnitude types".
 * The name must end the phrase, so "how many magnitude 5 or greater earthquakes" counts earthquakes, not magnitudes.
 */
export function countsNoun(question: string, nouns: string[]): boolean {
  const phrase = countedWords(question).join(' ')
  if (phrase === '') return false
  return nouns.some((noun) => {
    const name = noun.trim().toLowerCase()
    return name !== '' && new RegExp(`(?:^| )${nounPattern(name)}$`, 'i').test(phrase)
  })
}

/**
 * True when the question counts something other than the rows and names no grouping: "how many countries had
 * earthquakes?" counts groups, so the headline states how many groups there are. "How many sales per region?"
 * names a grouping, so its headline keeps the top group. A column name is checked before the row words, so
 * "how many items were there?" counts the groups of an "items" column rather than the rows.
 */
export function countsOtherThanRows(question: string, names: QuestionNouns = NO_VOCABULARY): boolean {
  const text = question.replace(/\bat (least|most)\b/gi, ' ')
  if (!HOW_MANY.test(question) || GROUPING_WORDS.test(text)) return false
  if (countsNoun(question, names.nouns)) return true
  return !countsNoun(question, rowNounList(names.rowNoun))
}

/** The dataset's row noun, then the plain words for rows. A count of any of them counts the rows. */
function rowNounList(rowNoun: string): string[] {
  return [rowNoun, ...ROW_NOUN_SYNONYMS]
}

/**
 * True when the question asks for one overall number and names no grouping. "How many <noun>" is a total
 * only when the noun is the dataset's row noun ("how many earthquakes"). A column or label ("how many
 * regions") counts groups. An unknown noun ("how many countries") counts groups too, even with explicit
 * total wording ("in total, how many countries"), because the dataset has no column for it. Only a raw upload,
 * which has no row noun to check against, reads an unknown noun as rows.
 */
export function asksForTotal(question: string, names: QuestionNouns = NO_VOCABULARY): boolean {
  const text = question.replace(/\bat (least|most)\b/gi, ' ')
  if (GROUPING_WORDS.test(text)) return false
  const explicit = EXPLICIT_TOTAL.test(question)
  if (!HOW_MANY.test(question)) return explicit
  if (countsNoun(question, names.nouns)) return false
  if (countsNoun(question, rowNounList(names.rowNoun))) return true
  if (countsUnknownNoun(question, names)) return false
  return explicit || names.rowNoun === RAW_VOCABULARY.rowNoun
}

/**
 * True when a "how many" question counts a noun the dataset does not name as its rows: "how many countries had
 * earthquakes", "how many earthquake types". The head noun of a counted phrase is its last word, so "how many
 * strong earthquakes" counts the rows. Explicit total wording does not change this on a dataset with a row noun.
 * On a raw upload no unknown noun is checked, because every counted noun reads as rows there.
 */
function countsUnknownNoun(question: string, names: QuestionNouns): boolean {
  const counted = countedWords(question)
  const head = counted[counted.length - 1]
  return head !== undefined && names.rowNoun !== RAW_VOCABULARY.rowNoun && !knownNoun(head, names)
}

/** The singular of a plain English noun, for comparing "countries" with "country" and "types" with "type". */
export function singular(word: string): string {
  return word.toLowerCase().replace(/ies$/, 'y').replace(/([^s])s$/, '$1')
}

/** Plain words for a category, read as the dataset's type column: "how many kinds of events" counts event types. */
const KIND_WORDS = ['kind', 'sort', 'category']
/** The last words of a column name that mark it as a category. */
const KIND_COLUMNS = ['type', 'kind', 'category']

/** The category column a word like "kinds" names, or null when the word is not one or the data has no such column. */
function kindColumn(word: string, columns: QuestionNouns['columns']): { header: string; label: string } | null {
  if (!KIND_WORDS.includes(singular(word))) return null
  const all = columns ?? []
  // A header such as "type" before a label such as "magnitude type", which would make two columns match.
  for (const named of [all.filter((column) => KIND_COLUMNS.includes(lastNoun(column.header))), all.filter((column) => KIND_COLUMNS.includes(lastNoun(column.label)))]) {
    if (named.length === 1) return named[0] ?? null
  }
  return null
}

/** True when the word names the rows, a plain word for rows, or a column (its last word in the header or label). */
function knownNoun(word: string, names: QuestionNouns): boolean {
  const target = singular(word)
  if (kindColumn(word, names.columns)) return true
  return [names.rowNoun, ...ROW_NOUN_SYNONYMS, ...names.nouns].some((name) => {
    const last = name.trim().toLowerCase().split(/\s+/).pop() ?? ''
    return last !== '' && singular(last) === target
  })
}

/**
 * The noun a question counts or asks about that the dataset has no column or row noun for: "countries" in "how many
 * countries had earthquakes?", "country" in "which country had the most". Null when the noun is known, or on a raw
 * upload, which has no row noun to check against.
 */
export function unknownNoun(question: string, names: QuestionNouns): string | null {
  if (names.rowNoun === RAW_VOCABULARY.rowNoun) return null
  const counted = countedWords(question)
  const named = counted[counted.length - 1] ?? /\bwhich\s+([a-z]+)\b/i.exec(question)?.[1]?.toLowerCase()
  return named !== undefined && !knownNoun(named, names) ? named : null
}

/** True when the filter's value is the noun itself ("tremor" for "tremors", "Japan" for "japan"). */
function filterNamesNoun(filter: PlanFilter, noun: string): boolean {
  const target = singular(noun.trim().toLowerCase().split(/\s+/).pop() ?? '')
  return target !== '' && singular(filter.value.trim().toLowerCase()) === target
}

/** True when some row has the filter's value in its column. Only a test for a value ("is", "contains") can fail to match. */
export function filterMatchesRows(filter: PlanFilter, rows: ParsedData['rows']): boolean {
  const value = filter.value.toLowerCase()
  if (filter.op !== 'eq' && filter.op !== 'contains') return true
  return rows.some((row) => {
    const cell = (row[filter.field] ?? '').toLowerCase()
    return filter.op === 'eq' ? cell === value : cell.includes(value)
  })
}

/**
 * True when a row noun comes before the head of the counted phrase with a word between: "earthquakes hit Iran" counts
 * earthquakes tested for Iran. "Tremors" has no row noun, and "earthquake aftershocks" is a different noun (its row
 * noun only describes the head), so neither counts.
 */
function rowNounBefore(question: string, names: QuestionNouns): boolean {
  const rowWords = rowNounList(names.rowNoun).map((word) => lastNoun(word))
  return countedWords(question).slice(0, -2).some((word) => rowWords.includes(singular(word)))
}

/** True when the question counts the row noun itself ("how many earthquakes", "how many quakes"), not "events" or "types". */
function countsRowNounItself(question: string, names: QuestionNouns): boolean {
  const head = singular(countedWords(question).pop() ?? '')
  const own = lastNoun(names.rowNoun)
  return head !== '' && (head === own || (head.length >= 4 && own.endsWith(head)))
}

/**
 * True when the noun is a value the question tests for: "Japan" in "how many earthquakes hit Japan", found in the data.
 * A value that finds no row still counts when the row noun comes before it ("earthquakes hit Iran" is 0 earthquakes),
 * but not "tremors", which has no row noun before it and so was made up by the model.
 */
function statedAsValue(plan: QueryPlan, noun: string, rows: ParsedData['rows'], question: string, names: QuestionNouns): boolean {
  const counted = rowNounBefore(question, names)
  return planFilters(plan).some((filter) => filterNamesNoun(filter, noun) && (counted || filterMatchesRows(filter, rows)))
}

/** The plan with these row tests, the first as `filter` and the rest as `moreFilters`. */
function withFilters(plan: QueryPlan, filters: PlanFilter[]): QueryPlan {
  const out: QueryPlan = { ...plan }
  delete out.filter
  delete out.moreFilters
  if (filters[0]) out.filter = filters[0]
  if (filters.length > 1) out.moreFilters = filters.slice(1)
  return out
}

/**
 * The plan without a row test that only restates the row noun ("event type is earthquake" when counting earthquakes).
 * The question never asked for it and it hides the rows of the other kinds. It stays when the question names another
 * value of that column ("quarry blasts and earthquakes"). It also stays when the question counts something other than
 * the row noun ("how many events were earthquakes") or names the column itself ("events with event type earthquake"):
 * the test is then the question's own.
 */
export function withoutRowNounFilter(plan: QueryPlan, question: string, names: QuestionNouns, rows: ParsedData['rows']): QueryPlan {
  if (names.rowNoun === RAW_VOCABULARY.rowNoun) return plan
  const text = question.toLowerCase()
  const namesOtherValue = (field: string) =>
    [...new Set(rows.map((row) => (row[field] ?? '').trim().toLowerCase()))].some(
      (value) =>
        value !== '' &&
        singular(value) !== singular(names.rowNoun.toLowerCase().split(/\s+/).pop() ?? '') &&
        new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s)?\\b`).test(text),
    )
  const counted = countedWords(question).length > 0
  const namesColumnOf = (field: string) => (names.columns ?? []).some((column) => column.header === field && namesColumnIn(question, column))
  const filters = planFilters(plan)
  const kept = filters.filter(
    (filter) =>
      !(
        (filter.op === 'eq' || filter.op === 'contains') &&
        filterNamesNoun(filter, names.rowNoun) &&
        !namesOtherValue(filter.field) &&
        (!counted || countsRowNounItself(question, names)) &&
        !namesColumnOf(filter.field)
      ),
  )
  return kept.length === filters.length ? plan : withFilters(plan, kept)
}

/**
 * True when the question counts the rows that pass a test for a value found in the data, with that value ending the
 * counted phrase: "how many earthquakes hit Japan this week" with region = Japan. The value is not a noun to count.
 */
export function countsRowsOfValue(question: string, names: QuestionNouns, plan: QueryPlan, rows: ParsedData['rows']): boolean {
  const text = question.replace(/\bat (least|most)\b/gi, ' ')
  if (!HOW_MANY.test(question) || GROUPING_WORDS.test(text)) return false
  const noun = unknownNoun(question, names)
  return noun !== null && rowNounBefore(question, names) && statedAsValue(plan, noun, rows, question, names)
}

/** The plan without the missing items that are values the plan filters on and finds in the rows: "Japan" is not a column. */
export function withoutValueMissing(plan: QueryPlan, rows: ParsedData['rows'], question: string, names: QuestionNouns): QueryPlan {
  if (!plan.missing) return plan
  const missing = plan.missing.filter((item) => !statedAsValue(plan, item, rows, question, names))
  if (missing.length === plan.missing.length) return plan
  const kept: QueryPlan = { ...plan, missing }
  if (missing.length === 0) delete kept.missing
  return kept
}

/**
 * True when the question names a grouping ("by", "top", "which") or counts a group: a column, a label or an unknown
 * noun. An unknown noun that is a value the plan filters on and finds in the rows ("Japan") is a place or a name, not a group.
 */
export function namesGroups(question: string, names: QuestionNouns, plan?: QueryPlan, rows: ParsedData['rows'] = []): boolean {
  const text = question.replace(/\bat (least|most)\b/gi, ' ')
  if (GROUPING_WORDS.test(text) || countsNoun(question, names.nouns)) return true
  const noun = countsUnknownNoun(question, names) ? unknownNoun(question, names) : null
  return noun !== null && !(plan && statedAsValue(plan, noun, rows, question, names))
}

/**
 * A plan for a question that names a noun the dataset has no column or row noun for. No filter that tests for the
 * noun is kept, since the question never asked for one. A grouping column that is unique to each row (an id) answers
 * nothing about groups, so the vocabulary's default column groups instead. `missing` names the noun, which makes the
 * headline lead with the notice. A model notice is kept, unless a filter was dropped: it would describe that filter.
 */
export function withMissingNoun(
  plan: QueryPlan,
  noun: string,
  names: QuestionNouns,
  rows: ParsedData['rows'],
  vocab: Vocabulary,
): QueryPlan {
  // A filter for the noun that finds no row was made up by the model. One that finds rows is a value the question stated.
  const kept = planFilters(plan).filter((filter) => !filterNamesNoun(filter, noun) || filterMatchesRows(filter, rows))
  const dropped = kept.length < planFilters(plan).length
  const out = withFilters(plan, kept)
  out.groupBy = fallbackGroup(out, names, rows, vocab) ?? out.groupBy
  return {
    ...out,
    missing: out.missing ?? [noun],
    // A model notice that describes the filter just dropped ('filters the type column for tremor') would contradict the chart.
    notice: (dropped ? undefined : out.notice) ?? `The data has no column for ${noun}, so the chart groups by ${labelFor(vocab, out.groupBy)} instead.`,
  }
}

/** The vocabulary's default group column, when the data has it. */
export function defaultGroup(names: QuestionNouns, vocab: Vocabulary): string | null {
  const fallback = vocab.defaultGroupBy
  return fallback && (names.columns ?? []).some((column) => column.header === fallback) ? fallback : null
}

/** The vocabulary's default group column when the plan groups by one unique to each row, else null. */
function fallbackGroup(plan: QueryPlan, names: QuestionNouns, rows: ParsedData['rows'], vocab: Vocabulary): string | null {
  const fallback = defaultGroup(names, vocab)
  return fallback && isUniqueByRow(rows, plan.groupBy) ? fallback : null
}

/** Every row test of a plan, the first one and the further ones. */
export function planFilters(plan: QueryPlan): PlanFilter[] {
  return [...(plan.filter ? [plan.filter] : []), ...(plan.moreFilters ?? [])]
}

/**
 * Reads the question's own words when the model named no countColumn. When its noun is one the dataset has no column
 * for, the plan gets a missing-noun notice, whatever column it groups by, so a count of countries grouped by region is
 * never a bare "74 regions.".
 */
export function groupUnknownNoun(
  plan: QueryPlan,
  question: string,
  names: QuestionNouns,
  rows: ParsedData['rows'],
  vocab: Vocabulary,
): QueryPlan {
  const noun = unknownNoun(question, names)
  if (!noun || namedColumn(question, names) !== null) return plan
  if (statedAsValue(plan, noun, rows, question, names)) return plan
  const invented = planFilters(plan).some((filter) => filterNamesNoun(filter, noun))
  // A model that already listed what is missing keeps its plan, unless it made up a filter or grouped by an id.
  if (plan.missing && !invented && fallbackGroup(plan, names, rows, vocab) === null) return plan
  return withMissingNoun(plan, noun, names, rows, vocab)
}

/** True when every row has its own value in the column, so grouping by it gives one group per row. */
function isUniqueByRow(rows: ParsedData['rows'], column: string): boolean {
  return rows.length > 1 && new Set(rows.map((row) => row[column])).size === rows.length
}

/** True when the text is the column's header or its label, singular or plural: "types" for "magnitude type". */
function namesColumn(text: string, column: { header: string; label: string }): boolean {
  return [column.header, column.label].some((name) => {
    const noun = name.trim().toLowerCase()
    return noun !== '' && new RegExp(`^${nounPattern(noun)}$`, 'i').test(text)
  })
}

/** True when the column's header or label appears as a noun anywhere in the question. */
function namesColumnIn(question: string, column: { header: string; label: string }): boolean {
  return [column.header, column.label].some((name) => {
    const noun = name.trim().toLowerCase()
    return noun !== '' && new RegExp(`\\b${nounPattern(noun)}\\b`, 'i').test(question)
  })
}

/**
 * The column the question names, as a header: the noun it counts ("how many regions" gives region, "how many
 * earthquake types" gives type), else the one column named anywhere in it. Null when the question names no
 * column, or names more than one and so does not say which one groups the answer.
 */
export function namedColumn(question: string, names: QuestionNouns): string | null {
  const columns = names.columns ?? []
  const counted = countedWords(question)
  if (counted.length > 0) {
    const phrase = counted.join(' ')
    const column =
      columns.find((candidate) => namesColumn(phrase, candidate)) ??
      columns.find((candidate) => namesColumn(counted[counted.length - 1] ?? '', candidate)) ??
      kindColumn(counted[counted.length - 1] ?? '', columns)
    if (column) return column.header
  }
  const named = columns.filter((column) => namesColumnIn(question, column))
  return named.length === 1 ? (named[0]?.header ?? null) : null
}

/** What a countColumn from the model names in this dataset. */
export type CountTarget = { kind: 'rows' } | { kind: 'column'; header: string } | { kind: 'unknown'; noun: string }

/** The last word of a name, singular: "event types" gives "type". */
function lastNoun(name: string): string {
  return singular(name.trim().toLowerCase().split(/\s+/).pop() ?? '')
}

/**
 * What the model's countColumn names: "rows" or any word for the rows ("earthquakes", "quakes") counts the rows, a
 * header, a label or the last word of one ("earthquake types" for "event type") counts that column's groups. Anything
 * else is a noun the dataset does not have. Matching is singular or plural, as for the words of a question.
 */
export function resolveCountColumn(value: string, names: QuestionNouns): CountTarget {
  const text = value.trim()
  const lower = text.toLowerCase()
  if (lower === ROWS) return { kind: 'rows' }
  const columns = names.columns ?? []
  const exact = columns.find((column) => column.header === text) ?? columns.find((column) => namesColumn(lower, column))
  if (exact) return { kind: 'column', header: exact.header }
  const last = lastNoun(lower)
  if (last !== '' && rowNounList(names.rowNoun).some((noun) => lastNoun(noun) === last)) return { kind: 'rows' }
  // The last word names a column outright ("types" for "type") before it matches the end of a longer name ("magnitude type").
  const similar =
    columns.find((column) => namesColumn(last, column)) ??
    kindColumn(last, columns) ??
    columns.find((column) => [column.header, column.label].some((name) => last !== '' && lastNoun(name) === last))
  return similar ? { kind: 'column', header: similar.header } : { kind: 'unknown', noun: text }
}
