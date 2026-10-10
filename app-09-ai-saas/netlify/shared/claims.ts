/**
 * Structured claims. The model writes its explanation, then a marker line and a JSON array that says what each figure
 * it wrote is about: a quote copied from the explanation, the kind of figure and the packages it concerns. The server
 * (1) finds each quote verbatim in the explanation, (2) reads the figure from the quote itself and compares it with
 * the one value the claim names, at the precision the text gives, and (3) leaves any figure no claim covers to the
 * older sentence-reading check, which can match it but never rejects it: what it cannot match is shown as unchecked.
 * The model's claim is never trusted for a value, only for what the figure is about.
 */

export const CLAIMS_MARKER = '===CLAIMS==='

export const CLAIM_KINDS = ['total', 'per_day', 'change_pct', 'share_pct', 'weekend_pct', 'multiple', 'difference', 'spike_downloads', 'spike_baseline', 'spike_pct', 'spike_count', 'date', 'version'] as const
export type ClaimKind = (typeof CLAIM_KINDS)[number]

export interface Claim {
  /** Words copied from the explanation that contain the figure. */
  q: string
  k: ClaimKind
  /** Packages the figure is about: one, or two for a multiple (the first is the one said to be larger). */
  p: string[]
  /** For a multiple: which figure the ratio is of. Absent means either. */
  m?: 'total' | 'per_day'
  /** For a spike kind: the spike's day. Absent means any of the package's spikes. */
  d?: string
}

const MAX_CLAIMS = 80

/** The instructions that ask for the claims. They come after the explanation instructions in the prompt. */
export function claimsPrompt(): string {
  return `

After the explanation, write a new line containing exactly ${CLAIMS_MARKER} and then a JSON array and nothing else (no code fence). Write one object for each number, percentage, multiple, date or version you wrote in the explanation:
{"q": words copied exactly from the explanation that contain the figure, at most 8 words, "k": what the figure is, "p": an array of the package names from the list above it is about, "m": "total" or "per_day" (multiples and differences), "d": the spike's date as YYYY-MM-DD (spike kinds only; leave the key out otherwise)}
For example: [{"q":"9.4 times","k":"multiple","p":["zod","@anthropic-ai/sdk"],"m":"total"},{"q":"40.1%","k":"share_pct","p":["zod"]}]
"k" is one of: total (a package's total downloads, or the selection's when "p" is empty), per_day (downloads per day), change_pct (the change between the halves), share_pct (share of the selection), weekend_pct (the weekend level or its gap to weekdays), multiple (N times: "p" has two packages, the one the sentence is about and names first, then the other), difference (the gap between two packages' downloads: "p" has both, "m" says total or per_day), spike_downloads, spike_baseline, spike_pct (a spike's day count, usual count, or percentage above usual), spike_count (how many unusual days: "p" is one package, or empty for all of them; say "with a release" or "no release" in the quote when the count is only of those), date, version.`
}

/** Passes text through until the claims marker, holding back just enough to see a marker split across chunks. */
export class ClaimSplitter {
  private held = ''
  found = false

  push(delta: string): string {
    if (this.found) return ''
    const all = this.held + delta
    const at = all.indexOf(CLAIMS_MARKER)
    if (at >= 0) {
      this.found = true
      this.held = ''
      return all.slice(0, at).trimEnd()
    }
    const keep = CLAIMS_MARKER.length - 1
    if (all.length <= keep) {
      this.held = all
      return ''
    }
    this.held = all.slice(-keep)
    return all.slice(0, -keep)
  }

  /** What was held back, once the stream ends without a marker. */
  flush(): string {
    const rest = this.found ? '' : this.held
    this.held = ''
    return rest
  }
}

/** The explanation and the raw claims text of a whole answer. `claimsRaw` is null when the model wrote no marker. */
export function splitAnswer(full: string): { explanation: string; claimsRaw: string | null } {
  const at = full.indexOf(CLAIMS_MARKER)
  if (at < 0) return { explanation: full, claimsRaw: null }
  return { explanation: full.slice(0, at).trimEnd(), claimsRaw: full.slice(at + CLAIMS_MARKER.length).trim() }
}

/** Reads the claims array. A code fence around it is tolerated. Null when it is not valid JSON of the expected shape. */
export function parseClaims(raw: string): Claim[] | null {
  let json: unknown
  try {
    json = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  } catch {
    return null
  }
  if (!Array.isArray(json) || json.length > MAX_CLAIMS) return null
  const claims: Claim[] = []
  for (const entry of json) {
    if (typeof entry !== 'object' || entry === null) return null
    const { q, k, p, m, d } = entry as Record<string, unknown>
    if (typeof q !== 'string' || q === '' || !CLAIM_KINDS.includes(k as ClaimKind)) return null
    // A single string is read as one entry; the checker splits it when it holds several names.
    const said = typeof p === 'string' ? [p] : p
    if (!Array.isArray(said) || !said.every((name) => typeof name === 'string') || said.length > 5) return null
    claims.push({
      q,
      k: k as ClaimKind,
      p: said as string[],
      ...(m === 'total' || m === 'per_day' ? { m } : {}),
      ...(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? { d } : {}),
    })
  }
  return claims
}

const words = (value: string): string[] => value.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part !== '')

/**
 * Finds the selection's package a claim means. An exact name, or the name after the scope, matches first; then a name
 * whose words include all of the claim's words ("the SDK", "Anthropic SDK" for @anthropic-ai/sdk), if that is one
 * package only. Null when nothing or more than one package fits.
 */
export function resolvePackage(said: string, names: string[]): string | null {
  const lower = said.trim().toLowerCase().replace(/^the\s+/, '')
  const exact = names.filter((name) => name.toLowerCase() === lower || name.toLowerCase().split('/').pop() === lower)
  if (exact.length === 1) return exact[0]
  const wanted = words(lower).filter((word) => word !== 'package' && word !== 'library')
  if (wanted.length === 0) return null
  const fits = names.filter((name) => wanted.every((word) => words(name).includes(word)))
  return fits.length === 1 ? fits[0] : null
}

/** The packages a claim names. An entry that is not one package but several names run together ("zod react") is split. */
export function resolvePackages(said: string[], names: string[]): (string | null)[] {
  return said.flatMap((entry) => {
    const whole = resolvePackage(entry, names)
    if (whole !== null || !/\s/.test(entry.trim())) return [whole]
    const parts = entry.trim().split(/[\s,;]+/).map((part) => resolvePackage(part, names))
    return parts.every((part) => part !== null) ? parts : [null]
  })
}


/**
 * A model sometimes corrects itself in the text it streams ("...wait, I must use only listed figures. Let me restate cleanly
 * as the final answer:") and then writes the answer again. Everything up to the end of that line is a draft: the reader is
 * shown, and the check reads, only what follows.
 */
const FINALISH = '(?:final|clean(?:ly)?|correct(?:ed|ly)?|properly|again|from scratch|answer)'
const RESTART = new RegExp(
  [
    // A line that is only a label announcing a corrected answer: "Correction:", "Actually, correction:", "Revised answer:".
    '(?:^|\\n)[ \\t]*(?:actually,?\\s*)?(?:correction|revised(?: answer)?|corrected(?: answer)?|final answer)[ \\t]*:',
    // "...wait, I must use only listed figures. Let me restate cleanly as the final answer:": the whole line, up to its colon.
    `[^\\n]*\\blet me (?:restate|rewrite|redo|start over|try again)\\b[^\\n:]*\\b${FINALISH}\\b[^\\n:]*:`,
    `[^\\n]*\\b(?:here is|here's) the (?:final|corrected|clean) (?:answer|version)[^\\n:]*:`,
  ].join('|'),
  'i',
)

/** The text after the last self-correction in `text`, or all of it when there is none. */
export function finalAnswer(text: string): string {
  let rest = text
  for (let match = RESTART.exec(rest); match; match = RESTART.exec(rest)) rest = rest.slice(match.index + match[0].length).replace(/^\s+/, '')
  return rest
}

/** Follows the streamed explanation and says when a self-correction completes, so the page can drop the draft it already showed. */
export class RestartTracker {
  private visible = ''
  private emitted = 0

  /** `reset` when everything shown so far is a draft; `text` is what to show next (all of the new answer after a reset). */
  push(delta: string): { reset: boolean; text: string } {
    this.visible += delta
    const match = RESTART.exec(this.visible)
    if (match) {
      this.visible = this.visible.slice(match.index + match[0].length).replace(/^\s+/, '')
      this.emitted = this.visible.length
      return { reset: true, text: this.visible }
    }
    const text = this.visible.slice(this.emitted)
    this.emitted = this.visible.length
    return { reset: false, text }
  }
}
