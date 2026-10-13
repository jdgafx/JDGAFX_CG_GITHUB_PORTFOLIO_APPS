// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { TRY_QUESTION } from '../../src/lib/howto'
import { parseEarthquakeCsv } from '../../src/lib/liveData/parse'
import { REPLAY_URL } from '../../src/lib/useReplay'
import { USGS_WEEK_EXCERPT } from '../fixtures/usgsWeek'

// The page and its client are the real ones; only the network is stubbed. The recording is served at the replay URL.
const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.csv'
const headers = parseEarthquakeCsv(USGS_WEEK_EXCERPT).headers
const PLAN = { chartType: 'bar', groupBy: 'region', aggregate: { field: 'id', fn: 'count' }, title: 'Earthquakes by region', explanation: '', sortBy: { field: 'id', dir: 'desc' } }
const REPLY = { result: PLAN, trace: [{ name: 'Build request', status: 'ok', ms: 1, detail: 'Sending 5 sample rows and 23 column names from a dataset of 2025 rows.' }, { name: 'Ask the model', status: 'ok', ms: 5, detail: 'plan' }], usage: { cost: 0.0012 }, model: 'test/recorded-model', newestModel: null, modelCheck: 'not-reported', checkedModel: null, totalMs: 5 }

function recording(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    app: 'app-05-ai-data-analyst',
    url: 'https://example.test/',
    recorded_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    reported: { model: 'test/recorded-model', model_role: 'served by', cost_usd: 0.0012, cost_scope: 'whole run' },
    exchanges: [{
      method: 'POST', path: '/api/ai', request_body: JSON.stringify({ question: TRY_QUESTION, headers, sampleRows: [], rowCount: 1 }),
      status: 200, headers: { 'content-type': 'application/json' }, t_start: 0, t_headers: 20, t_end: 25, chunks: [{ t: 22, text: JSON.stringify(REPLY) }],
    }],
    ...overrides,
  }
}

interface Network {
  /** Every call that reached the network: the replay must add none to /api/ai. */
  calls: string[]
}

function stubNetwork(recorded: unknown): Network {
  const network: Network = { calls: [] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      network.calls.push(url)
      if (url === FEED_URL) return new Response(USGS_WEEK_EXCERPT, { status: 200 })
      if (url === REPLAY_URL) return recorded === null ? new Response('', { status: 404 }) : new Response(typeof recorded === 'string' ? recorded : JSON.stringify(recorded), { status: 200 })
      return new Response(JSON.stringify(REPLY), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
  return network
}

let container: HTMLDivElement
let root: Root
const text = () => container.textContent ?? ''
const apiCalls = (network: Network) => network.calls.filter((url) => url.startsWith('/api/'))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('the load-time replay', () => {
  it('draws the live feed at once, plays the recording through the page, labels it, and sends no /api/ai request', async () => {
    const network = stubNetwork(recording())
    await act(async () => root.render(<App />))
    await vi.waitFor(() => expect(text()).toContain('Earthquakes per day'))
    await vi.waitFor(() => expect(container.querySelector('[data-replay-label]')).not.toBeNull())
    await vi.waitFor(() => expect(text()).toMatch(/California has the highest number of earthquakes: 20/))
    const label = container.querySelector('[data-replay-label]')?.textContent ?? ''
    expect(label).toContain('Replay of a real run')
    expect(label).toContain('served by test/recorded-model')
    expect(label).toContain('whole run $0.001200')
    expect(label).toContain('Run it live')
    expect(text()).toContain('Replay')
    expect(apiCalls(network)).toEqual([])
  })

  it('states the rows on screen in the replayed trace, never the recorded row count', async () => {
    stubNetwork(recording())
    await act(async () => root.render(<App />))
    await vi.waitFor(() => expect(text()).toMatch(/California has the highest number of earthquakes: 20/))
    const trace = container.querySelector('.ds-trace')?.textContent ?? ''
    expect(trace).toContain('the dataset on screen now holds 59 rows')
    expect(trace).not.toContain('2025')
    expect(text()).not.toContain('2025 rows')
  })

  it('Run it live clears the replay and makes a real request', async () => {
    const network = stubNetwork(recording())
    await act(async () => root.render(<App />))
    await vi.waitFor(() => expect(text()).toMatch(/California has the highest number of earthquakes: 20/))
    const live = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Run it live')
    await act(async () => live?.click())
    await vi.waitFor(() => expect(apiCalls(network)).toEqual(['/api/ai']))
    await vi.waitFor(() => expect(container.querySelector('[data-replay-label]')).toBeNull())
    expect(container.querySelectorAll('.app-replay-tag')).toHaveLength(0)
    // The live run keeps its own label, with the model and cost it reported; the trace of a live run is the server's own text.
    await vi.waitFor(() => expect(container.querySelector('[data-live-label]')).not.toBeNull())
    expect(container.querySelector('[data-live-model]')?.textContent).toBe('served by recorded-model')
    expect(container.querySelector('[data-live-cost]')?.textContent).toBe('whole run $0.001200')
    expect(container.querySelector('.ds-trace')?.textContent).toContain('2025 rows')
  })

  it.each([
    ['a missing recording', null],
    ['a malformed recording', '{"version":'],
    ['a stale recording', recording({ recorded_at: new Date(Date.now() - 4 * 86_400_000).toISOString() })],
    ['a recording of another question', recording({ exchanges: [{ ...recording().exchanges[0], request_body: JSON.stringify({ question: 'Count by type', headers }) }] })],
  ])('shows today\'s empty state, with the live feed drawn, for %s', async (_name, recorded) => {
    const network = stubNetwork(recorded)
    await act(async () => root.render(<App />))
    await vi.waitFor(() => expect(text()).toContain('Earthquakes per day'))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(container.querySelector('[data-replay-label]')).toBeNull()
    expect(text()).toContain('Ask a question')
    expect(apiCalls(network)).toEqual([])
  })
})
