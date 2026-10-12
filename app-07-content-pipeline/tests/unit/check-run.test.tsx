// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { formatSourcePack, withSources, type SourcePack } from '../../netlify/shared/sourcepack'

// Only the network is mocked. The page, the run path and the citation check are the real ones.
const SUMMARY = 'Its intricate deployment was successfully completed on January 4, 2022, ten days after launch, when it was more than 0.8 million kilometers (500,000 mi) away from Earth.'
const PACK: SourcePack = { sources: [{ n: 1, kind: 'wikipedia', title: 'JWST sunshield', url: 'https://en.wikipedia.org/wiki/JWST_sunshield', summary: SUMMARY }], notes: [] }
const PLANTED = 'Once in place, the telescope settled into its operating position, more than 0.8 million kilometers from Earth [1].'
const CONTROL = 'Its deployment was completed on January 4, 2022, ten days after launch [1].'
const POLISH = withSources(`${PLANTED} ${CONTROL}`, PACK, 'Newsletter')
const WRITING = 'The sunshield keeps the telescope cold by blocking the light and heat of the Sun, Earth and Moon from its mirror.'
const usage = { prompt_tokens: 900, completion_tokens: 300, total_tokens: 1200, cost: 0.0004 }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const stageAnswer = (stage: string, result: string) => json({
  result,
  trace: [{ name: stage, status: 'ok', ms: 1000, detail: 'done', tokens: 1200, cost: 0.0004 }],
  usage: stage === 'sources' ? null : usage,
  model: stage === 'sources' ? null : 'anthropic/claude-haiku-5.5',
  newestModel: 'anthropic/claude-haiku-5.5',
  modelCheck: stage === 'sources' ? null : 'match',
  totalMs: 1000,
})

const checkAnswer = () => json({
  claims: [
    { id: 1, text: PLANTED, verdict: 'partly', reason: 'The source gives the distance at deployment.', uncovered: 'operating position' },
    { id: 2, text: CONTROL, verdict: 'supported', reason: 'ok' },
  ],
  calls: [{ claims: [1, 2], ms: 4100, status: 'ok', detail: '2 of 2 sentences answered.', usage, model: 'anthropic/claude-haiku-5.5', newestModel: 'anthropic/claude-haiku-5.5', modelCheck: 'match' }],
  ms: 4200,
})

function serve(check: () => Response): string[] {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input))
    if (String(input) === '/api/check') return check()
    const stage = (JSON.parse(String(init?.body)) as { stage: string }).stage
    return stageAnswer(stage, stage === 'sources' ? formatSourcePack(PACK) : stage === 'polish' ? POLISH : WRITING)
  }))
  return urls
}

let container: HTMLDivElement
let root: Root

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function tryIt() {
  const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === 'Try it')
  await act(async () => button?.click())
}

describe('a run followed by the citation check', () => {
  it('checks the polished piece in its own request and marks each cited sentence, counting the check in the totals', async () => {
    const urls = serve(checkAnswer)
    await act(async () => root.render(<App />))
    await tryIt()

    await vi.waitFor(() => expect(container.textContent).toContain('Citation check: 1 of 2 cited sentences confirmed'))
    expect(urls.filter(url => url === '/api/check')).toHaveLength(1)
    expect(urls[urls.length - 1]).toBe('/api/check')
    expect(container.textContent).toContain('Final piece')
    expect(container.querySelectorAll('.cite[data-cite="not_confirmed"]')).toHaveLength(1)
    expect(container.querySelectorAll('.cite[data-cite="confirmed"]')).toHaveLength(1)
    expect(container.textContent).toContain('Not confirmed')
    expect(container.textContent).toContain('Citation check')
    // Five written steps and the check call, each 1,200 tokens.
    expect(container.textContent).toContain('7,200')
  })

  it('still shows the finished piece, with its cited sentences not checked, when the check fails', async () => {
    serve(() => json({ error: 'The citation check took too long.', unreported: 1 }, 504))
    await act(async () => root.render(<App />))
    await tryIt()

    await vi.waitFor(() => expect(container.textContent).toContain('The citation check could not run'))
    expect(container.textContent).toContain('Final piece')
    expect(container.textContent).toContain('Complete')
    expect(container.querySelectorAll('.cite[data-cite="not_checked"]')).toHaveLength(2)
    expect(container.querySelectorAll('.cite[data-cite="confirmed"]')).toHaveLength(0)
    // The call that may have been billed is counted as not reported.
    expect(container.textContent).toContain('1 call not reported')
  })
})
