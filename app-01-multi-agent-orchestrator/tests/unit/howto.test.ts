import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HowTo } from '../../src/components/HowTo'
import { EXAMPLES } from '../../src/lib/agents'
import { startResearch } from '../../src/lib/api'
import { HOWTO_HINT, HOWTO_STEPS, HOWTO_WHAT, TRY_IT } from '../../src/lib/howto'
import { VERDICT_VIEW } from '../../src/lib/verdict'

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

  it('names controls and verdicts with the text they show on screen', () => {
    const screen = read('src/components/QueryBar.tsx')
    const quoted = HOWTO_STEPS.flatMap((step) => [...step.matchAll(/"([^"]+)"/g)].map((m) => m[1]))
    expect(quoted).toEqual(['Research topic', 'Examples', 'Start research'])
    for (const label of quoted) expect(screen).toContain(label)
    expect(HOWTO_STEPS[2]).toContain(`${VERDICT_VIEW.supported.word}, ${VERDICT_VIEW.partly.word} or ${VERDICT_VIEW.unsupported.word}`)
  })
})

describe('Try it', () => {
  it('runs one of the examples, as an input and nothing else', () => {
    expect(EXAMPLES).toContain(TRY_IT)
  })

  it('starts the real run path: the example goes to the research endpoint, and Try it hands the same text to the example handler', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    // The empty reply ends the stream early; only the request it made matters here.
    await startResearch(TRY_IT.question, () => undefined).catch(() => undefined)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ query: TRY_IT.question })
    expect(read('src/App.tsx')).toContain('onTry={() => handleExample(TRY_IT.question)}')
  })
})
