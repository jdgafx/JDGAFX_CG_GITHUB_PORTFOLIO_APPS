// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from '../../src/components/Dashboard'
import { addDays, todayUtc } from '../../src/lib/dates'
import { rangeUrl, requestRange } from '../../src/lib/npm'
import { TRY_IT } from '../../src/lib/tryIt'

// Only the network is mocked here. The page, its Try it button and the explain run are the real ones.
const NPM_RANGE = /^https:\/\/api\.npmjs\.org\/downloads\/range\/(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})\//

interface Sent {
  url: string
  body: Record<string, unknown> | null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A npm range reply with a positive count for every day from `start` to `end`, so no day is an npm gap. */
function npmReply(start: string, end: string): Response {
  const downloads: { day: string; downloads: number }[] = []
  for (let day = start, i = 0; day <= end; day = addDays(day, 1), i += 1) downloads.push({ day, downloads: 1000 + ((i * 37) % 900) })
  return json({ downloads })
}

// Answers the npm ranges, the release records and the explain request; records every request the page sends.
function serve(): Sent[] {
  const sent: Sent[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
      sent.push({ url, body })
      const range = NPM_RANGE.exec(url)
      if (range) return npmReply(range[1], range[2])
      if (url.startsWith('/api/releases?')) return json({ time: { '1.0.0': '2020-01-01T00:00:00.000Z', '2.0.0': '2023-06-01T00:00:00.000Z' } })
      return json({ error: 'The test ends the run here.' }, 500)
    }),
  )
  return sent
}

let container: HTMLDivElement
let root: Root

function buttonNamed(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === label)
  if (!found) throw new Error(`No button named "${label}"`)
  return found
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
  // The line charts measure their width with ResizeObserver, which jsdom does not provide.
  vi.stubGlobal('ResizeObserver', class { observe() { return undefined } unobserve() { return undefined } disconnect() { return undefined } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Try it on the real page', () => {
  it('loads the four example packages over a year and runs the explanation on them', async () => {
    const sent = serve()
    await act(async () => root.render(<Dashboard />))
    await vi.waitFor(() => expect(sent.some((r) => NPM_RANGE.test(r.url))).toBe(true))
    expect(sent.some((r) => r.url.includes('%40anthropic-ai%2Fsdk'))).toBe(false) // before the click the page shows its own first preset

    const beforeClick = sent.length
    await act(async () => buttonNamed('Try it').click())

    await vi.waitFor(() => expect(sent.some((r) => r.url === '/api/ai')).toBe(true), { timeout: 5000 })
    const requested = sent.slice(beforeClick).map((r) => r.url)
    const { start, end } = requestRange(TRY_IT.days, todayUtc())
    for (const name of TRY_IT.names) expect(requested).toContain(rangeUrl(name, start, end))

    const explain = sent.find((r) => r.url === '/api/ai')
    const summary = explain?.body?.summary as { packages: { name: string }[]; windowDays: number }
    expect(summary.packages.map((p) => p.name)).toEqual([...TRY_IT.names])
    expect(summary.windowDays).toBe(TRY_IT.days)
  })
})
