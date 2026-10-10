import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HowTo } from '../../src/components/HowTo'
import { startIssue } from '../../src/lib/api'
import { getIssue, parseIssueRef } from '../../src/lib/github'
import { HOWTO_HINT, HOWTO_STEPS, HOWTO_WHAT, TRY_IT_ISSUE } from '../../src/lib/howto'
import type { IssueInput } from '../../src/types'
import { apiItem } from '../helpers/issues'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const render = (hasResult: boolean, disabled = false) =>
  renderToStaticMarkup(createElement(HowTo, { what: HOWTO_WHAT, steps: HOWTO_STEPS, onTry: () => undefined, disabled, hasResult, hint: HOWTO_HINT }))

afterEach(() => vi.unstubAllGlobals())

describe('How to use block', () => {
  it('has an h2, one to four numbered steps and a Try it button', () => {
    const html = render(false)
    expect(html).toMatch(/<h2[^>]*>How to use<\/h2>/)
    const items = html.match(/<li>/g) ?? []
    expect(html).toContain('<ol')
    expect(items.length).toBeGreaterThanOrEqual(1)
    expect(items.length).toBeLessThanOrEqual(4)
    expect(html).toMatch(/<button[^>]*>Try it<\/button>/)
  })

  it('folds away while a result is shown, keeping the heading and its toggle', () => {
    const html = render(true)
    expect(html).toContain('How to use')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('<ol')
    expect(html).not.toContain('Try it')
  })

  it('disables Try it while a run is live', () => {
    expect(render(false, true)).toMatch(/<button[^>]*disabled=""[^>]*>Try it<\/button>/)
  })

  it('names controls with the text they show on screen, and says nothing is posted', () => {
    const screen = ['src/App.tsx', 'src/components/RepoPicker.tsx', 'src/components/IssueList.tsx', 'src/components/ApprovalCard.tsx'].map(read).join('\n')
    const quoted = HOWTO_STEPS.flatMap((step) => [...step.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? ''))
    expect(quoted).toEqual(['Well-known repos', 'Any repo or one issue', 'Issue', 'Triage', 'Approve', 'Edit labels and priority', 'Reject'])
    for (const label of quoted) expect(screen).toContain(label)
    expect(HOWTO_STEPS.join(' ')).toContain('Nothing is posted to GitHub')
  })
})

describe('Try it', () => {
  it('loads one real issue from GitHub by its reference, then sends it down the Triage path', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('https://api.github.com/')
          ? new Response(JSON.stringify(apiItem({ number: 325240, title: 'The new look', body: 'It looks cute but I do not like it.', html_url: 'https://github.com/microsoft/vscode/issues/325240' })), { status: 200 })
          : new Response('', { status: 200 }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const ref = parseIssueRef(TRY_IT_ISSUE)
    expect(ref).toEqual({ owner: 'microsoft', repo: 'vscode', number: 325240 })
    const issue = await getIssue(ref!)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/microsoft/vscode/issues/325240')
    // The empty reply ends the stream early; only the request it made matters here.
    await startIssue(issue, () => undefined).catch(() => undefined)
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(url).toBe('/api/start')
    expect((JSON.parse(init.body as string) as { issue: IssueInput }).issue.number).toBe(325240)
    expect(read('src/App.tsx')).toMatch(/await loadIssues\(TRY_IT_ISSUE\)[\s\S]*?triage\(issue\)/)
  })
})
