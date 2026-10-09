import type {
  Classification,
  HumanDecision,
  IssueInput,
  IssueType,
  Priority,
  Severity,
  Triage,
  TriageOutcome,
} from '../../src/types'
import { LABEL_VOCABULARY } from '../../src/types'

/** Below this confidence the rules do not trust the classification alone. */
export const CONFIDENCE_FLOOR = 0.75

/**
 * Words that mark a possible security report. They are checked on the issue text itself, so a model
 * that was talked out of the flag cannot talk the rules out of it. A false alarm only costs a pause.
 */
const SECURITY_WORDS =
  /\b(?:security|vulnerab\w*|CVE-\d{4}-\d+|XSS|CSRF|RCE|SSRF|exploit\w*|injection|privilege\s+escalation|auth(?:entication)?\s+bypass|(?:leak\w*|expos\w*)\s+(?:a\s+|the\s+|an\s+)?(?:token|secret|password|credential|api\s+key)s?)\b/i

/** Wording aimed at an assistant, not at a maintainer. Such an issue is read by a person. */
const INSTRUCTION_WORDS =
  /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules)\b|\bsystem\s+prompt\b|\byou\s+are\s+now\b|\b(?:classify|label|triage)\s+(?:this|it)\s+as\b|\bas\s+an\s+ai\b/i

const TYPE_LABEL: Partial<Record<IssueType, string>> = {
  bug: 'bug',
  feature: 'enhancement',
  question: 'question',
  docs: 'documentation',
}

const SEVERITY_PRIORITY: Record<Severity, Priority> = { low: 'low', medium: 'medium', high: 'high', critical: 'urgent' }

const percent = (value: number) => `${Math.round(value * 100)}%`

export function looksLikeSecurityReport(issue: IssueInput): boolean {
  return SECURITY_WORDS.test(`${issue.title}\n${issue.body}`)
}

export function aimsAtAssistant(issue: IssueInput): boolean {
  return INSTRUCTION_WORDS.test(`${issue.title}\n${issue.body}`)
}

/**
 * The gate. Pure and deterministic: the same issue and classification always give the same verdict.
 * A maintainer must look at a possible security report, issue text aimed at an assistant, a
 * classification below the confidence floor, an unclear or possibly duplicated report, a bug of
 * medium severity or worse, and anything that is not a bug, feature, question or docs issue.
 * Everything else is triaged by the rules alone.
 */
export function decideTriage(issue: IssueInput, classification: Classification): Triage {
  const security = classification.possibleSecurity || looksLikeSecurityReport(issue)
  const reasons: string[] = []
  if (security) reasons.push('It may be a security report, so a maintainer should read it before anything is said in public.')
  if (aimsAtAssistant(issue)) reasons.push('The issue text contains instructions aimed at an AI assistant.')
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
  if (classification.duplicateLikely) labels.push('possible-duplicate')
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
  }
}

export interface FinalTriage {
  outcome: TriageOutcome
  labels: string[]
  priority: Priority | null
  note: string | null
}

/**
 * The triage after the maintainer answered. Approve keeps the proposal, edit applies the maintainer's
 * labels and priority, and reject applies nothing. With no answer, which only happens on the automatic
 * path, the proposal stands.
 */
export function resolveTriage(triage: Triage, human: HumanDecision | null): FinalTriage {
  const note = human?.note ?? null
  if (!human) return { outcome: 'auto', labels: triage.labels, priority: triage.priority, note }
  if (human.action === 'reject') return { outcome: 'rejected', labels: [], priority: null, note }
  if (human.action === 'edit') {
    return { outcome: 'edited', labels: human.labels ?? [], priority: human.priority ?? triage.priority, note }
  }
  return { outcome: 'approved', labels: triage.labels, priority: triage.priority, note }
}

/** Null when every label is one the maintainer may use: the vocabulary, or a label this proposal offered. */
export function labelsProblem(labels: readonly string[], proposed: readonly string[]): string | null {
  const allowed = new Set<string>([...LABEL_VOCABULARY, ...proposed])
  const unknown = labels.find((label) => !allowed.has(label))
  return unknown === undefined ? null : `"${unknown}" is not one of the labels offered. Pick from the list.`
}
