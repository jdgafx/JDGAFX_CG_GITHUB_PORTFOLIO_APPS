import type { DuplicateCandidate } from '../../src/types'

/**
 * The deterministic half of duplicate detection: which words to search for, and how the search results are
 * ranked before the model sees any of them. No model and no clock are used, so the same issue and the same
 * results always give the same order.
 */

/** One issue from the GitHub search reply, reduced to the fields the ranking and the judge need. */
export interface SearchedIssue {
  number: number
  title: string
  body: string
  htmlUrl: string
  state: 'open' | 'closed'
  stateReason: string | null
  createdAt: string
  updatedAt: string
}

const STOPWORDS = new Set(
  (
    'the and for with this that from have has had not but are was were you your can could would should does did doing done will ' +
    'when what which while where why how who into onto over under than then them they their there here been being also just only ' +
    'some any all each more most such very too out off use used using uses get gets got set sets run runs ran make makes made ' +
    'need needs want wants like see seen try tried work works working worked after before about above below again still ' +
    'issue issues bug bugs problem problems error errors fail fails failed failing failure wrong broken support supports add adds ' +
    'new feature request please thanks thank version versions expect expected actual steps reproduce reproduction describe ' +
    'description describes behavior behaviour happen happens happened happening occur occurs cannot cant dont doesnt isnt wont ' +
    'unable able should shouldnt seems seem appears appear think thing things something nothing anything everything one two'
  ).split(' '),
)

/** Words under this length are noise unless they mix letters and digits, like "v8" or "h2". */
const MIN_WORD = 3

/** How many runs of letters or digits a token has: "arm64" has 2, "03t05" has 3. */
const letterDigitRuns = (word: string) => (word.match(/[a-z]+|\d+/g) ?? []).length

/** A light stem: plural and past-tense endings go, so "crashes" and "crash" meet. Never below four letters. */
function stem(word: string): string {
  for (const ending of ['ing', 'ed', 'es', 's']) {
    if (word.endsWith(ending) && word.length - ending.length >= 4) return word.slice(0, -ending.length)
  }
  return word
}

/** Lowercase terms in order of appearance, stopwords and very short words dropped, stemmed. Duplicates are kept. */
export function tokenize(text: string): string[] {
  const terms: string[] = []
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw) continue
    const mixed = /[a-z]/.test(raw) && /\d/.test(raw)
    if (raw.length < MIN_WORD && !(mixed && raw.length >= 2)) continue
    // Hashes, timestamps and build ids (a44adf7f, 03t05, 26200x) are not words.
    if (/^(?=.*\d)[0-9a-f]{7,}$/.test(raw) || (mixed && letterDigitRuns(raw) > 2)) continue
    if (/^\d+$/.test(raw) && (raw.length < 3 || raw.length > 4)) continue
    if (STOPWORDS.has(raw)) continue
    terms.push(stem(raw))
  }
  return terms
}

/**
 * Words that fill nearly every issue of a software project. They stay in the search as filler, but a word that
 * is not on this list is treated as the rarer one and goes first.
 */
const GENERIC = new Set(
  (
    'import imports importing imported export exports exporting module modules file files plugin plugins config configuration ' +
    'option options build builds building dev server client page pages load loading type types code default value values name names ' +
    'path paths package packages dependency dependencies project projects test tests testing cli api app application component components ' +
    'function functions request requests response responses data regression crash crashes crashing throw throws unexpected incorrect ' +
    'correctly properly missing allow allows support react node browser output input result results change changes update updates ' +
    'create creates created remove removes call calls called option setting settings property properties class method methods'
  ).split(' '),
)

/**
 * The words to search for, rarest first: the title's own words that are not generic, longest and most
 * identifier-like first (a name with a digit, an underscore or a capital in the middle is rarer than a plain
 * word), then the generic ones. At most five, because GitHub allows five operators in one query. Words come
 * back as they were written, lowercased and unstemmed. The repo's own name is left out, since nearly every issue
 * of that repo contains it.
 */
export function searchTerms(title: string, body: string, repo = '', limit = 5): string[] {
  const seen = new Set<string>(repo.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  const scored: Array<{ word: string; score: number; order: number }> = []
  const add = (text: string, bonus: number) => {
    for (const match of text.matchAll(/[A-Za-z0-9_]+/g)) {
      const original = match[0]
      const word = original.toLowerCase()
      if (seen.has(word) || tokenize(word).length === 0) continue
      seen.add(word)
      const identifier = /\d|_/.test(word) || /[a-z][A-Z]/.test(original) ? 4 : 0
      const rare = GENERIC.has(word) ? 0 : 20
      // Verbs and adverbs (showing, getting, becomes) say less than the nouns around them.
      const loose = /(?:ing|ed|ly|er|es)$/.test(word) && !identifier ? -6 : 0
      scored.push({ word, score: word.length + identifier + bonus + rare + loose, order: scored.length })
    }
  }
  add(title, 6)
  if (scored.length < 3) add(proseOf(body).slice(0, 600), 0)
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.word)
}

/**
 * Two GitHub search queries over the repo's issues, open and closed. The strict one needs the two rarest words
 * together, which finds a near-copy of the title. The broad one accepts any of the words, and GitHub's own
 * relevance order puts the issues that match the most, and the rarest, words first.
 */
export function buildQueries(repo: string, terms: readonly string[]): { strict: string; broad: string } {
  return {
    strict: `repo:${repo} is:issue ${terms.slice(0, 2).join(' ')} in:title,body`,
    broad: `repo:${repo} is:issue (${terms.join(' OR ')}) in:title,body`,
  }
}

/** Template sections that describe the reporter's machine, not the problem. Everything from the first one on is dropped. */
const NOISE_SECTION = /^#{1,6}[ \t]*(?:system[ \t]+info|environment|envinfo|logs?|validations?|used[ \t]+package[ \t]+manager|additional[ \t]+context|checklist)\b/im

/** The part of an issue body that describes the problem: comments, links and the machine-info sections removed. */
export function proseOf(body: string): string {
  const cut = body.search(NOISE_SECTION)
  return (cut >= 0 ? body.slice(0, cut) : body).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<details[\s\S]*?<\/details>/gi, ' ').replace(/https?:\/\/\S+/g, ' ')
}

const BODY_TERMS_CHARS = 1500

interface Doc {
  /** term -> 2 when it is in the title, 1 when only in the body */
  weights: Map<string, number>
}

function docOf(title: string, body: string): Doc {
  const weights = new Map<string, number>()
  for (const term of tokenize(proseOf(body).slice(0, BODY_TERMS_CHARS))) weights.set(term, 1)
  for (const term of tokenize(title)) weights.set(term, 2)
  return { weights }
}

/** The best candidates first. Rare shared words count most, and a shared title word counts double. */
export function rankCandidates(
  target: { number: number; title: string; body: string },
  found: readonly SearchedIssue[],
  limit = 5,
): DuplicateCandidate[] {
  const seen = new Set<number>([target.number])
  const pool = found.filter((item) => {
    if (seen.has(item.number)) return false
    seen.add(item.number)
    return true
  })
  const goal = docOf(target.title, target.body)
  const docs = pool.map((item) => docOf(item.title, item.body))
  // Document frequency over the target and every candidate, so a word every result shares says little.
  const total = docs.length + 1
  const df = new Map<string, number>()
  for (const doc of [goal, ...docs]) for (const term of doc.weights.keys()) df.set(term, (df.get(term) ?? 0) + 1)
  const idf = (term: string) => Math.log(1 + total / (df.get(term) ?? 1))
  const vector = (doc: Doc) => new Map([...doc.weights].map(([term, weight]) => [term, weight * idf(term)]))
  const norm = (vec: Map<string, number>) => Math.sqrt([...vec.values()].reduce((sum, value) => sum + value * value, 0))
  const goalVec = vector(goal)
  const goalNorm = norm(goalVec)

  const ranked = pool.map((item, index) => {
    const vec = vector(docs[index])
    const shared = [...goalVec.keys()].filter((term) => vec.has(term))
    const dot = shared.reduce((sum, term) => sum + (goalVec.get(term) ?? 0) * (vec.get(term) ?? 0), 0)
    const denominator = goalNorm * norm(vec)
    const score = denominator === 0 ? 0 : dot / denominator
    shared.sort((a, b) => (goalVec.get(b) ?? 0) * (vec.get(b) ?? 0) - (goalVec.get(a) ?? 0) * (vec.get(a) ?? 0) || a.localeCompare(b))
    return { item, score: Math.round(score * 1000) / 1000, shared: shared.slice(0, 6) }
  })
  ranked.sort((a, b) => b.score - a.score || (a.item.updatedAt < b.item.updatedAt ? 1 : a.item.updatedAt > b.item.updatedAt ? -1 : 0) || b.item.number - a.item.number)
  return ranked.slice(0, limit).map(({ item, score, shared }) => ({
    number: item.number,
    title: item.title,
    htmlUrl: item.htmlUrl,
    state: item.state,
    stateReason: item.stateReason,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    score,
    sharedTerms: shared,
    judgement: null,
  }))
}

/** A candidate must reach this score and share at least two terms before the model is asked about it. */
export const JUDGE_MIN_SCORE = 0.12
export const JUDGE_COUNT = 3

export function worthJudging(candidate: DuplicateCandidate): boolean {
  return candidate.score >= JUDGE_MIN_SCORE && candidate.sharedTerms.length >= 2
}

/** Merges two result lists, the first winning, one entry per issue number. */
export function mergeFound(...lists: ReadonlyArray<readonly SearchedIssue[]>): SearchedIssue[] {
  const byNumber = new Map<number, SearchedIssue>()
  for (const list of lists) for (const item of list) if (!byNumber.has(item.number)) byNumber.set(item.number, item)
  return [...byNumber.values()]
}
