import type {
  Classification,
  DuplicateReport,
  TriageAction,
  HumanDecision,
  IssueInput,
  IssueType,
  Priority,
  Severity,
  Triage,
  TriageOutcome,
} from '../../src/types'
import { LABEL_VOCABULARY } from '../../src/types'
import { assistantEvidence } from './assistant-address'

/** Below this confidence the rules do not trust the classification alone. */
export const CONFIDENCE_FLOOR = 0.75

/**
 * Words that mark a possible security report. They are checked on the issue text itself, so a model
 * that was talked out of the flag cannot talk the rules out of it. A false alarm only costs a pause.
 */
const SECURITY_WORDS =
  /\b(?:security|vulnerab\w*|CVE-\d{4}-\d+|XSS|CSRF|RCE|SSRF|exploit\w*|injection|privilege\s+escalation|auth(?:entication)?\s+bypass|(?:leak\w*|expos\w*)\s+(?:a\s+|the\s+|an\s+)?(?:token|secret|password|credential|api\s+key)s?)\b/i

const TYPE_LABEL: Partial<Record<IssueType, string>> = {
  bug: 'bug',
  feature: 'enhancement',
  question: 'question',
  docs: 'documentation',
}

const SEVERITY_PRIORITY: Record<Severity, Priority> = { low: 'low', medium: 'medium', high: 'high', critical: 'urgent' }

/** The evidence as it is shown in a reason: one line, at most 120 characters. */
const quoteOf = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 120 ? `${line.slice(0, 117).trimEnd()}...` : line
}

const percent = (value: number) => `${Math.round(value * 100)}%`

export function looksLikeSecurityReport(issue: IssueInput): boolean {
  return SECURITY_WORDS.test(`${issue.title}\n${issue.body}`)
}

/**
 * The issue text without the sentences that hold the words aimed at the assistant (the quote, widened to the
 * whole sentence or line, whatever spacing it was written with), so those sentences cannot add a keyword.
 */
function withoutInjection(issue: IssueInput, injected: string): string {
  const text = `${issue.title}\n${issue.body}`
  const flexible = injected.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  const found = new RegExp(flexible, 'i').exec(text)
  if (!found) return text
  const before = Math.max(text.lastIndexOf('\n', found.index), text.lastIndexOf('. ', found.index) + 1, text.lastIndexOf('! ', found.index) + 1, text.lastIndexOf('? ', found.index) + 1)
  const ends = [text.indexOf('\n', found.index + found[0].length), text.indexOf('. ', found.index + found[0].length), text.indexOf('! ', found.index + found[0].length), text.indexOf('? ', found.index + found[0].length)].filter((i) => i >= 0)
  const after = ends.length > 0 ? Math.min(...ends) + 1 : text.length
  return `${text.slice(0, Math.max(0, before))} ${text.slice(after)}`
}

/**
 * The gate. Pure and deterministic: the same issue and classification always give the same verdict.
 * A maintainer must look at a possible security report, issue text aimed at an assistant (by the model's
 * verified quote or by a pattern, see assistant-address.ts), a
 * classification below the confidence floor, an unclear or possibly duplicated report, a bug of
 * medium severity or worse, and anything that is not a bug, feature, question or docs issue.
 * Everything else is triaged by the rules alone.
 */
export function decideTriage(issue: IssueInput, classification: Classification, duplicates: DuplicateReport | null = null): Triage {
  const aimed = assistantEvidence(issue, classification)
  // Text aimed at the assistant must not be able to raise the priority by containing a keyword: the security
  // words are looked for in the rest of the issue. The reason then says so.
  const keywordInText = looksLikeSecurityReport(issue)
  const keywordOutsideInjection = aimed ? SECURITY_WORDS.test(withoutInjection(issue, aimed)) : keywordInText
  const security = classification.possibleSecurity || keywordOutsideInjection
  const reasons: string[] = []
  const original = duplicates?.candidates.find((candidate) => candidate.number === duplicates.confirmed) ?? null
  if (original?.judgement) {
    reasons.push(`It looks like a duplicate of #${original.number} (${quoteOf(original.title)}). ${original.judgement.reason}`.trim())
  }
  if (security) reasons.push('It may be a security report, so a maintainer should read it before anything is said in public.')
  if (aimed) {
    const ignored = keywordInText && !keywordOutsideInjection ? ' A security word appears only inside that text, so it was not counted as a security report.' : ''
    reasons.push(`The issue text contains instructions aimed at an AI assistant. It says: "${quoteOf(aimed)}".${ignored}`)
  }
  if (classification.confidence < CONFIDENCE_FLOOR) {
    reasons.push(`The classifier was not sure (confidence ${percent(classification.confidence)}).`)
  }
  if (classification.unclear) reasons.push('The report is unclear or missing details.')
  if (classification.duplicateLikely) reasons.push('It may duplicate an existing issue.')
  if (classification.type === 'bug' && classification.severity !== 'low') {
    reasons.push(`It is a bug of ${classification.severity} severity.`)
  }
  if (classification.type === 'other') reasons.push('It does not fit bug, feature, question or docs.')

  const labels: string[] = []
  const typeLabel = TYPE_LABEL[classification.type]
  if (typeLabel) labels.push(typeLabel)
  if (classification.area) labels.push(`area: ${classification.area}`)
  if (classification.unclear) labels.push('needs-info')
  if (original) labels.push('duplicate')
  else if (classification.duplicateLikely) labels.push('possible-duplicate')
  if (security) labels.push('security')

  const priority: Priority = security
    ? 'urgent'
    : classification.type === 'bug' && !classification.unclear
      ? SEVERITY_PRIORITY[classification.severity]
      : 'low'

  const requiresHuman = reasons.length > 0
  return {
    requiresHuman,
    reasons,
    reason: requiresHuman
      ? reasons.join(' ')
      : `A clear ${classification.type} at ${percent(classification.confidence)} confidence is low risk, so the rules triage it without a maintainer.`,
    labels,
    priority,
    action: original ? 'close_duplicate' : 'label',
    duplicateOf: original ? { number: original.number, htmlUrl: original.htmlUrl, title: original.title } : null,
  }
}

export interface FinalTriage {
  outcome: TriageOutcome
  labels: string[]
  priority: Priority | null
  note: string | null
  /** close_duplicate only when a maintainer approved a proposal to close the issue as a duplicate. */
  action: TriageAction
  duplicateOf: Triage['duplicateOf']
}

/**
 * The triage after the maintainer answered. Approve keeps the proposal, edit applies the maintainer's
 * labels and priority, and reject applies nothing. With no answer, which only happens on the automatic
 * path, the proposal stands.
 */
export function resolveTriage(triage: Triage, human: HumanDecision | null): FinalTriage {
  const note = human?.note ?? null
  const none = { action: 'label' as const, duplicateOf: null }
  if (!human) return { outcome: 'auto', labels: triage.labels, priority: triage.priority, note, ...none }
  if (human.action === 'reject') return { outcome: 'rejected', labels: [], priority: null, note, ...none }
  // An edit sets labels and priority only: it does not carry the proposal to close the issue.
  if (human.action === 'edit') {
    return { outcome: 'edited', labels: human.labels ?? [], priority: human.priority ?? triage.priority, note, ...none }
  }
  return {
    outcome: 'approved',
    labels: triage.labels,
    priority: triage.priority,
    note,
    action: triage.action ?? 'label',
    duplicateOf: triage.duplicateOf ?? null,
  }
}

/** Null when every label is one the maintainer may use: the vocabulary, or a label this proposal offered. */
export function labelsProblem(labels: readonly string[], proposed: readonly string[]): string | null {
  const allowed = new Set<string>([...LABEL_VOCABULARY, ...proposed])
  const unknown = labels.find((label) => !allowed.has(label))
  return unknown === undefined ? null : `"${unknown}" is not one of the labels offered. Pick from the list.`
}
