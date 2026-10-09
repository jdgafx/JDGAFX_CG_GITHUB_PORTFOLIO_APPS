import { z } from 'zod'

/**
 * Reads the first JSON object in a model reply. Code fences and prose around the object
 * are tolerated. Returns undefined when no object parses.
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown
  } catch {
    return undefined
  }
}

const PlanReply = z.object({ queries: z.array(z.string()).min(1) })

/** Up to three distinct queries, whitespace collapsed and each cut to 120 characters. */
export function parseQueries(text: string): string[] {
  const parsed = PlanReply.safeParse(extractJson(text))
  if (!parsed.success) return []
  const cleaned = parsed.data.queries
    .map((query) => query.replace(/\s+/g, ' ').trim().slice(0, 120))
    .filter((query) => query !== '')
  return [...new Set(cleaned)].slice(0, 3)
}

const CriticIssueReply = z.union([
  z.string(),
  z.object({ quote: z.string().optional(), fix: z.string().optional() }),
])

const CriticReply = z.object({
  verdict: z.enum(['accept', 'revise']),
  issues: z.array(CriticIssueReply).optional(),
  notes: z.string().optional(),
})

/** One concrete problem: the words of the draft (or of the question) that are wrong or missing, and the fix. */
export interface CriticIssue {
  quote: string
  fix: string
}

export interface CriticVerdict {
  verdict: 'accept' | 'revise'
  /** The problems the critic named. A revise verdict is acted on only when one is grounded in the text. */
  issues: CriticIssue[]
  /** The issues as one line for the page and the next draft. */
  notes: string
}

const NOTES_MAX_CHARS = 600
const ISSUES_MAX = 5

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Cuts text to `max` characters at the last sentence end, else the last space, and marks a word cut with an ellipsis. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  if (sentence >= max * 0.5) return head.slice(0, sentence + 1)
  const space = head.lastIndexOf(' ')
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[\s,;:.]+$/, '')}…`
}

/** The issues as one line: each quote with its fix, cut to the notes limit. */
export function issueNotes(issues: CriticIssue[]): string {
  const line = issues.map((issue) => (issue.quote === '' ? issue.fix : `"${issue.quote}": ${issue.fix}`)).join(' ')
  return clipText(line, NOTES_MAX_CHARS)
}

/**
 * The issues whose quote is really in one of the given texts, ignoring case and spacing. An issue that
 * quotes nothing, or quotes words that are not there, is not concrete and does not send a draft back.
 */
export function groundedIssues(issues: CriticIssue[], ...texts: string[]): CriticIssue[] {
  const haystacks = texts.map((text) => squash(text).toLowerCase())
  return issues.filter((issue) => {
    const quote = squash(issue.quote).toLowerCase()
    return quote.length >= 3 && haystacks.some((haystack) => haystack.includes(quote))
  })
}

/** The critic's verdict, or null when the reply is not the expected JSON. */
export function parseCritic(text: string): CriticVerdict | null {
  const parsed = CriticReply.safeParse(extractJson(text))
  if (!parsed.success) return null
  const issues = (parsed.data.issues ?? [])
    .map((issue): CriticIssue => (typeof issue === 'string' ? { quote: '', fix: squash(issue) } : { quote: squash(issue.quote ?? ''), fix: squash(issue.fix ?? '') }))
    .filter((issue) => issue.fix !== '')
    .slice(0, ISSUES_MAX)
  const notes = issues.length > 0 ? issueNotes(issues) : clipText(squash(parsed.data.notes ?? ''), NOTES_MAX_CHARS)
  return { verdict: parsed.data.verdict, issues, notes }
}
