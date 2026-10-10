// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { TRY_QUESTION } from '../../src/lib/howto'
import type { QueryPlan } from '../../src/types'
import { USGS_WEEK_EXCERPT } from '../fixtures/usgsWeek'

// Only the network is mocked here. The page, its buttons and the run path are the real ones.
const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.csv'
// The recorded excerpt holds 59 data rows, so the request the page builds carries 59.
const EXCERPT_ROWS = 59

// The plan the model returns for the example question: one count per region, largest first.
const REGION_PLAN: QueryPlan = {
  chartType: 'bar',
  groupBy: 'region',
  aggregate: { field: 'id', fn: 'count' },
  sortBy: { field: 'id', dir: 'desc' },
  title: 'Earthquakes by region',
  explanation: '',
}

interface ApiCall {
  url: string
  body: Record<string, unknown>
}

interface Network {
  /** Every /api/ai request the page sent, in order. */
  api: ApiCall[]
  /** Every USGS feed request the page sent. */
  feedRequests: string[]
  /** The feed answer for the next request. Changing it changes what the next load gets. */
  feed: () => Promise<Response>
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Routes the two browser requests the page can make: the live feed, and the analysis.
function stubNetwork(): Network {
  const network: Network = {
    api: [],
    feedRequests: [],
    feed: () => Promise.resolve(new Response(USGS_WEEK_EXCERPT, { status: 200 })),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === FEED_URL) {
        network.feedRequests.push(url)
        return network.feed()
      }
      network.api.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      return json({ result: REGION_PLAN, trace: [], usage: {}, model: 'test-model', totalMs: 1 })
    }),
  )
  return network
}

let container: HTMLDivElement
let root: Root

function buttonNamed(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === label)
  if (!found) throw new Error(`No button named "${label}"`)
  return found
}

// The How to use block, where the Try it error and its Try again button appear.
const howTo = (): HTMLElement => {
  const section = container.querySelector<HTMLElement>('section.howto')
  if (!section) throw new Error('No How to use block')
  return section
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
  // The chart measures its frame; jsdom has no layout, so the observer does nothing here.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Try it on the live feed', () => {
  it('waits for the feed while it loads, then asks the example question about its rows', async () => {
    const network = stubNetwork()
    let releaseFeed: (response: Response) => void = () => undefined
    network.feed = () => new Promise<Response>((resolve) => (releaseFeed = resolve))
    await act(async () => root.render(<App />))

    await act(async () => buttonNamed('Try it').click())

    // The click came before the rows arrived: the page says it is loading and sends nothing yet.
    expect(howTo().textContent).toContain('Loading the live feed.')
    expect(network.feedRequests).toEqual([FEED_URL])
    expect(network.api).toHaveLength(0)

    await act(async () => releaseFeed(new Response(USGS_WEEK_EXCERPT, { status: 200 })))

    await vi.waitFor(() => expect(network.api).toHaveLength(1))
    expect(network.api[0]).toMatchObject({
      url: '/api/ai',
      body: { question: TRY_QUESTION, rowCount: EXCERPT_ROWS },
    })
    await vi.waitFor(() => expect(container.textContent).toContain('Plan and run complete.'))
  })

  it('shows the feed error with a Try again button on load, and sends no analysis request', async () => {
    const network = stubNetwork()
    network.feed = () => Promise.resolve(new Response('', { status: 503 }))
    await act(async () => root.render(<App />))

    await vi.waitFor(() => expect(howTo().querySelector('[role="alert"]')?.textContent).toContain('USGS answered with status 503.'))
    expect(howTo().querySelector('[role="alert"]')?.textContent).toContain('Try again')
    expect(network.feedRequests).toEqual([FEED_URL])
    expect(network.api).toHaveLength(0)
  })

  it('ends a waiting Try it when the feed fails, so a later Try again starts no run by itself', async () => {
    const network = stubNetwork()
    let settleFeed: (response: Response) => void = () => undefined
    network.feed = () => new Promise<Response>((resolve) => (settleFeed = resolve))
    await act(async () => root.render(<App />))
    await act(async () => buttonNamed('Try it').click())
    expect(howTo().textContent).toContain('Loading the live feed.')

    await act(async () => settleFeed(new Response('', { status: 503 })))
    await vi.waitFor(() => expect(howTo().querySelector('[role="alert"]')?.textContent).toContain('USGS answered with status 503.'))
    expect(network.api).toHaveLength(0)

    network.feed = () => Promise.resolve(new Response(USGS_WEEK_EXCERPT, { status: 200 }))
    await act(async () => buttonNamed('Try again').click())

    await vi.waitFor(() => expect(container.textContent).toMatch(/Live data: USGS · fetched \d\d:\d\d/))
    expect(network.feedRequests).toHaveLength(2)
    expect(network.api).toHaveLength(0)

    await act(async () => buttonNamed('Try it').click())
    await vi.waitFor(() => expect(network.api).toHaveLength(1))
    expect(network.api[0]?.body).toMatchObject({ question: TRY_QUESTION, rowCount: EXCERPT_ROWS })
  })
  it('fetches a failed feed again when Try it is pressed, and runs the example once the rows arrive', async () => {
    const network = stubNetwork()
    network.feed = () => Promise.resolve(new Response('', { status: 503 }))
    await act(async () => root.render(<App />))
    await vi.waitFor(() => expect(howTo().querySelector('[role="alert"]')).not.toBeNull())

    network.feed = () => Promise.resolve(new Response(USGS_WEEK_EXCERPT, { status: 200 }))
    await act(async () => buttonNamed('Try it').click())

    await vi.waitFor(() => expect(network.api).toHaveLength(1))
    expect(network.feedRequests).toHaveLength(2)
    expect(network.api[0]?.body).toMatchObject({ question: TRY_QUESTION, rowCount: EXCERPT_ROWS })
  })
})
