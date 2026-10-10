import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HowTo } from '../../src/components/HowTo'
import { SAMPLE_QUESTIONS } from '../../src/lib/constants'
import { HOWTO_HINT, HOWTO_STEPS, HOWTO_WHAT, TRY_IT } from '../../src/lib/howto'
import { streamResearch } from '../../src/lib/research'

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

  it('names controls with the text they show on screen', () => {
    const screen = ['src/components/QuestionForm.tsx', 'src/components/RunTrace.tsx'].map(read).join('\n')
    const quoted = HOWTO_STEPS.flatMap((step) => [...step.matchAll(/"([^"]+)"/g)].map((m) => m[1]))
    expect(quoted).toEqual(['Your question', 'Examples', 'Start research', 'Rewind here and edit'])
    for (const label of quoted) expect(screen).toContain(label)
  })
})

describe('Try it', () => {
  it('runs one of the examples, as an input and nothing else', () => {
    expect(SAMPLE_QUESTIONS).toContain(TRY_IT)
  })

  it('starts the real run path: the example question goes to /api/run, and Try it hands the same text to submit', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    // The empty reply ends the stream early; only the request it made matters here.
    await streamResearch(TRY_IT.question, new AbortController().signal, () => undefined).catch(() => undefined)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/run')
    expect(JSON.parse(init.body as string)).toEqual({ question: TRY_IT.question })
    expect(read('src/App.tsx')).toMatch(/const tryIt = \(\) => \{\s*setQuestion\(TRY_IT\.question\)\s*void submit\(TRY_IT\.question\)/)
  })
})
