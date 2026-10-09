import { describe, expect, it } from 'vitest'
import { issueFrom, issueRefOf, issueUrl } from '../../netlify/shared/issue-input'
import { BODY_MAX_LENGTH, LABELS_MAX, LABEL_MAX_LENGTH, TITLE_MAX_LENGTH } from '../../src/lib/limits'
import { issue } from '../helpers/issues'

const ok = (value: unknown) => issueFrom({ issue: value })
const message = (value: unknown) => {
  const result = ok(value)
  if (result.ok) throw new Error('expected a refusal')
  return result.message
}

describe('issueFrom: what the start function accepts', () => {
  it('returns every field of a valid issue unchanged', () => {
    const valid = issue({ labels: ['bug', 'help wanted'], authorAssociation: 'MEMBER', comments: 0 })
    expect(ok(valid)).toEqual({ ok: true, value: valid })
  })

  it('accepts an empty body, which GitHub reports for an issue with no text', () => {
    expect(ok(issue({ body: '' })).ok).toBe(true)
  })

  it('accepts the largest title and body, counted in characters', () => {
    expect(ok(issue({ title: 'a'.repeat(TITLE_MAX_LENGTH), body: '\u{1F600}'.repeat(BODY_MAX_LENGTH) })).ok).toBe(true)
  })

  it('trims the title and removes control characters from the text, keeping newlines', () => {
    const result = ok(issue({ title: '  Crash\u0000 on start\u0007  ', body: 'line one\nline two\u001b[31m' }))
    expect(result).toMatchObject({ ok: true, value: { title: 'Crash on start', body: 'line one\nline two[31m' } })
  })

  it('refuses a body that is not an object with an issue', () => {
    expect(issueFrom(null)).toEqual({ ok: false, message: 'Send the GitHub issue to triage.' })
    expect(issueFrom({ ticket: 'old shape' })).toEqual({ ok: false, message: 'Send the GitHub issue to triage.' })
    expect(issueFrom({ issue: 'text' })).toEqual({ ok: false, message: 'Send the GitHub issue to triage.' })
    expect(issueFrom({ issue: [issue()] })).toEqual({ ok: false, message: 'Send the GitHub issue to triage.' })
  })

  it.each(['acme', 'acme/', '/widgets', 'acme/widgets/extra', 'ac me/widgets', '-acme/widgets', 'acme/wid gets', 'acme/wid<script>', ''])(
    'refuses the repository %j',
    (repo) => {
      expect(message({ ...issue(), repo })).toBe('The repository must look like owner/name.')
    },
  )

  it('refuses a repository that is not text', () => {
    expect(message({ ...issue(), repo: 42 })).toBe('The repository must look like owner/name.')
  })

  it.each([0, -1, 1.5, '12', null, Number.NaN, 1e12])('refuses the issue number %j', (number) => {
    expect(message({ ...issue(), number })).toBe('The issue number is not valid.')
  })

  it('refuses a missing, blank or over-long title', () => {
    const rule = `The issue title must be 1 to ${TITLE_MAX_LENGTH} characters.`
    expect(message({ ...issue(), title: '' })).toBe(rule)
    expect(message({ ...issue(), title: '   ' })).toBe(rule)
    expect(message({ ...issue(), title: undefined })).toBe(rule)
    expect(message({ ...issue(), title: 'a'.repeat(TITLE_MAX_LENGTH + 1) })).toBe(rule)
  })

  it('refuses a body that is not text or is over 6,000 characters', () => {
    expect(message({ ...issue(), body: null })).toBe('The issue body must be text. Send an empty string when there is none.')
    expect(message({ ...issue(), body: 'a'.repeat(BODY_MAX_LENGTH + 1) })).toBe('The issue body must be at most 6,000 characters.')
  })

  it('refuses labels that are not a short list of short text', () => {
    expect(message({ ...issue(), labels: 'bug' })).toContain('Send at most 30 labels')
    expect(message({ ...issue(), labels: Array(LABELS_MAX + 1).fill('bug') })).toContain('Send at most 30 labels')
    const rule = `Each label must be 1 to ${LABEL_MAX_LENGTH} characters.`
    expect(message({ ...issue(), labels: [''] })).toBe(rule)
    expect(message({ ...issue(), labels: [3] })).toBe(rule)
    expect(message({ ...issue(), labels: ['x'.repeat(LABEL_MAX_LENGTH + 1)] })).toBe(rule)
  })

  it('refuses an author association GitHub does not use', () => {
    expect(message({ ...issue(), authorAssociation: 'ADMIN' })).toBe('The author association is not one GitHub uses.')
    expect(message({ ...issue(), authorAssociation: 'owner' })).toBe('The author association is not one GitHub uses.')
  })

  it.each(['2026-10-09', 'yesterday', '2026-10-09T12:00:00+02:00', '2026-13-45T99:00:00Z', 20261009, null])(
    'refuses the created date %j',
    (createdAt) => {
      expect(message({ ...issue(), createdAt })).toBe('The created date must be an ISO time such as 2026-10-09T12:00:00Z.')
    },
  )

  it.each([-1, 1.5, '3', null, 2_000_000])('refuses the comment count %j', (comments) => {
    expect(message({ ...issue(), comments })).toBe('The comment count is not valid.')
  })
})

describe('issueFrom: the link must be the page of this very issue', () => {
  it('builds the canonical link from the repo and the number', () => {
    expect(issueUrl('acme/widgets', 7)).toBe('https://github.com/acme/widgets/issues/7')
  })

  it.each([
    ['another repository', 'https://github.com/acme/other/issues/101'],
    ['another issue number', 'https://github.com/acme/widgets/issues/102'],
    ['another host', 'https://evil.example.test/acme/widgets/issues/101'],
    ['plain http', 'http://github.com/acme/widgets/issues/101'],
    ['a pull request page', 'https://github.com/acme/widgets/pull/101'],
    ['a trailing path', 'https://github.com/acme/widgets/issues/101/'],
    ['a query string', 'https://github.com/acme/widgets/issues/101?x=1'],
    ['a different case', 'https://github.com/Acme/widgets/issues/101'],
    ['a look-alike host', 'https://github.com.evil.example.test/acme/widgets/issues/101'],
  ])('refuses %s', (_name, htmlUrl) => {
    expect(message({ ...issue(), htmlUrl })).toBe(
      'The link must be https://github.com/acme/widgets/issues/101, the page of this issue.',
    )
  })

  it('refuses a missing link', () => {
    expect(message({ ...issue(), htmlUrl: undefined })).toContain('The link must be')
  })

  it('keeps only the issue reference for the cards', () => {
    expect(issueRefOf(issue({ number: 5 }))).toEqual({
      repo: 'acme/widgets',
      number: 5,
      title: 'How do I configure the proxy for the dev server?',
      htmlUrl: 'https://github.com/acme/widgets/issues/5',
    })
  })
})
