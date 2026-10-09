import type { Classification, IssueInput, ReviewPayload } from '../../src/types'

/** A valid issue as the browser sends it. Tests override the fields they care about. */
export function issue(overrides: Partial<IssueInput> = {}): IssueInput {
  const number = overrides.number ?? 101
  const repo = overrides.repo ?? 'acme/widgets'
  return {
    repo,
    number,
    title: 'How do I configure the proxy for the dev server?',
    body: 'I read the docs on the dev server but could not find where the proxy target is set.',
    labels: [],
    authorAssociation: 'NONE',
    createdAt: '2026-10-08T12:00:00Z',
    htmlUrl: `https://github.com/${repo}/issues/${number}`,
    comments: 2,
    ...overrides,
  }
}

/** A clear question: the rules triage it without a maintainer. */
export const QUESTION = issue()

/** A bug of high severity: the graph pauses for a maintainer. */
export const BUG = issue({
  number: 202,
  title: 'Router crashes when the page unmounts during navigation',
  body: 'Steps to reproduce: open /a, click a link to /b and go back quickly. Expected: no error. Actual: TypeError in the console.',
  labels: ['bug'],
})

export const CLASSIFIED_QUESTION: Classification = {
  type: 'question',
  area: 'dev server',
  severity: 'low',
  unclear: false,
  duplicateLikely: false,
  possibleSecurity: false,
  confidence: 0.93,
  summary: 'The author asks where the dev server proxy target is configured.',
}

export const CLASSIFIED_BUG: Classification = {
  type: 'bug',
  area: 'router',
  severity: 'high',
  unclear: false,
  duplicateLikely: false,
  possibleSecurity: false,
  confidence: 0.9,
  summary: 'The router throws a TypeError when the page unmounts during navigation.',
}

/** The shape of GET /repos/{owner}/{repo}/issues, trimmed to the fields the page reads. */
export function apiItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const number = typeof overrides.number === 'number' ? overrides.number : 7
  return {
    number,
    title: 'Crash on startup',
    body: 'It crashes.',
    state: 'open',
    html_url: `https://github.com/acme/widgets/issues/${number}`,
    created_at: '2026-10-07T08:30:00Z',
    comments: 3,
    author_association: 'CONTRIBUTOR',
    labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'help wanted', color: '008672' }],
    user: { login: 'someone', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
    ...overrides,
  }
}

/** What the review node hands to interrupt() for the BUG issue. */
export const PROPOSAL: ReviewPayload = {
  issue: { repo: 'acme/widgets', number: 202, title: BUG.title, htmlUrl: BUG.htmlUrl },
  classification: CLASSIFIED_BUG,
  triage: {
    requiresHuman: true,
    reasons: ['It is a bug of high severity.'],
    reason: 'It is a bug of high severity.',
    labels: ['bug', 'area: router'],
    priority: 'high',
  },
}
