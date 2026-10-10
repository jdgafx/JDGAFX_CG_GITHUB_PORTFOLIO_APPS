// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { EXAMPLES } from '../../src/components/Brief'

// Only the network is mocked here. The page, its click handlers and the run path are the real ones.
const FIRST = EXAMPLES[0]
const OTHER_TOPIC = 'Why unit tests matter for small teams'

interface Sent {
  url: string
  body: Record<string, unknown>
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// The Sources answer for the example: one Wikipedia article, as the server returns it.
const sourcesFound = () => json({
  result: '[1] Wikipedia: Rust (programming language)\nURL: https://en.wikipedia.org/wiki/Rust_(programming_language)\nSummary: Rust is a systems programming language that focuses on memory safety.',
  trace: [{ name: 'Sources', status: 'ok', ms: 812, detail: '1 source: 1 Wikipedia, 0 Hacker News.' }],
  usage: null,
  model: null,
  totalMs: 812,
}, 200)

// The Sources answer when no lookup could be reached, as the server returns it.
const sourcesUnreachable = () => json({
  error: 'No live source could be reached. Wikipedia was unavailable. Hacker News did not answer in time. Try again.',
  retryable: false,
  trace: [{ name: 'Sources', status: 'failed', ms: 5000, detail: 'No live source could be reached. Wikipedia was unavailable. Hacker News did not answer in time. Try again.' }],
  usage: null,
  model: null,
  totalMs: 5000,
}, 502)

// Ends any later stage in this test, so the run stops at a known point.
const stopHere = () => json({
  error: 'The test ends the run here.',
  retryable: false,
  trace: [{ name: 'Research', status: 'failed', ms: 1, detail: 'The test ends the run here.' }],
  usage: null,
  model: null,
  totalMs: 1,
}, 500)

// Answers the first browser request with `first` and records every request the page sends.
function serve(first: () => Response): Sent[] {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return sent.length === 1 ? first() : stopHere()
  }))
  return sent
}

let container: HTMLDivElement
let root: Root

function buttonNamed(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === label)
  if (!found) throw new Error(`No button named "${label}"`)
  return found
}

// Types into the Topic box the way a visitor does: a native value set, then an input event for React.
async function typeTopic(value: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>('#topic')
  if (!textarea) throw new Error('No Topic box')
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => {
    setValue?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
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

describe('Try it', () => {
  it('starts the first example as a real run, even after the visitor typed another topic', async () => {
    const sent = serve(sourcesFound)
    await act(async () => root.render(<App />))
    await typeTopic(OTHER_TOPIC)
    expect(container.querySelector<HTMLTextAreaElement>('#topic')?.value).toBe(OTHER_TOPIC)

    await act(async () => buttonNamed('Try it').click())

    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0))
    expect(sent[0]).toMatchObject({
      url: '/api/ai',
      body: { stage: 'sources', topic: FIRST.topic, contentType: FIRST.type },
    })
    expect(sent[0].body.topic).not.toBe(OTHER_TOPIC)
  })

  it('shows the Sources error and a Try again button when no live source could be reached', async () => {
    serve(sourcesUnreachable)
    await act(async () => root.render(<App />))

    await act(async () => buttonNamed('Try it').click())

    await vi.waitFor(() => expect(container.textContent).toContain('The run failed'))
    expect(container.textContent).toContain('Sources did not finish')
    expect(container.textContent).toContain('No live source could be reached.')
    expect(container.textContent).toContain('Live data unavailable: Wikipedia + Hacker News')
    expect(container.textContent).not.toContain('Final piece')
    expect(Array.from(container.querySelectorAll('button')).map(button => button.textContent?.trim())).toContain('Try again from Sources')
  })
})
