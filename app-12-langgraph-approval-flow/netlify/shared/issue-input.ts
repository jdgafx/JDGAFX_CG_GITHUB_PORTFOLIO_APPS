import {
  BODY_MAX_LENGTH,
  LABELS_MAX,
  LABEL_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  lengthOf,
} from '../../src/lib/limits'
import { AUTHOR_ASSOCIATIONS, type AuthorAssociation, type IssueInput, type IssueRef } from '../../src/types'
import { isRecord, type Checked } from './guard'

const REPO = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const MAX_ISSUE_NUMBER = 100_000_000
const MAX_COMMENTS = 1_000_000
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/** The canonical issue page for a repo and number. The start function accepts no other link. */
export function issueUrl(repo: string, number: number): string {
  return `https://github.com/${repo}/issues/${number}`
}

export function issueRefOf(issue: IssueInput): IssueRef {
  return { repo: issue.repo, number: issue.number, title: issue.title, htmlUrl: issue.htmlUrl }
}

function bad(message: string): { ok: false; message: string } {
  return { ok: false, message }
}

/** Text with control characters removed, or null when it is not a string. Newlines and tabs stay. */
function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value.replace(CONTROL, '') : null
}

/**
 * The issue from a start request body. The page fetched it from GitHub, but the request can come
 * from anywhere, so every field is checked here: its type, its length, and that the link is exactly
 * the issue page for the repo and number. The text is kept as data and never read as instructions.
 */
export function issueFrom(body: unknown): Checked<IssueInput> {
  const raw = isRecord(body) ? body.issue : undefined
  if (!isRecord(raw)) return bad('Send the GitHub issue to triage.')

  const repo = textOf(raw.repo)
  if (repo === null || !REPO.test(repo)) return bad('The repository must look like owner/name.')
  const number = raw.number
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1 || number > MAX_ISSUE_NUMBER) {
    return bad('The issue number is not valid.')
  }
  const title = textOf(raw.title)?.trim() ?? ''
  if (!title || lengthOf(title) > TITLE_MAX_LENGTH) return bad(`The issue title must be 1 to ${TITLE_MAX_LENGTH} characters.`)
  const issueBody = textOf(raw.body)
  if (issueBody === null) return bad('The issue body must be text. Send an empty string when there is none.')
  if (lengthOf(issueBody) > BODY_MAX_LENGTH) {
    return bad(`The issue body must be at most ${BODY_MAX_LENGTH.toLocaleString('en-US')} characters.`)
  }

  const rawLabels = raw.labels
  if (!Array.isArray(rawLabels) || rawLabels.length > LABELS_MAX) return bad(`Send at most ${LABELS_MAX} labels as a list of text.`)
  const labels: string[] = []
  for (const entry of rawLabels) {
    const label = textOf(entry)?.trim()
    if (!label || lengthOf(label) > LABEL_MAX_LENGTH) return bad(`Each label must be 1 to ${LABEL_MAX_LENGTH} characters.`)
    labels.push(label)
  }

  const association = AUTHOR_ASSOCIATIONS.find((known) => known === raw.authorAssociation) as AuthorAssociation | undefined
  if (!association) return bad('The author association is not one GitHub uses.')
  const createdAt = raw.createdAt
  if (typeof createdAt !== 'string' || !CREATED_AT.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) {
    return bad('The created date must be an ISO time such as 2026-10-09T12:00:00Z.')
  }
  const comments = raw.comments
  if (typeof comments !== 'number' || !Number.isSafeInteger(comments) || comments < 0 || comments > MAX_COMMENTS) {
    return bad('The comment count is not valid.')
  }
  if (raw.htmlUrl !== issueUrl(repo, number)) {
    return bad(`The link must be ${issueUrl(repo, number)}, the page of this issue.`)
  }

  return {
    ok: true,
    value: { repo, number, title, body: issueBody, labels, authorAssociation: association, createdAt, htmlUrl: issueUrl(repo, number), comments },
  }
}
