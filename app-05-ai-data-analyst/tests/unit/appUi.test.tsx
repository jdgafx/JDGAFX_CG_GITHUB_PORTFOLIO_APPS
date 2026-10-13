// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { USGS_WEEK_EXCERPT } from '../fixtures/usgsWeek'

// The page, its buttons and the run path are the real ones; only the network is stubbed. The plans are replies the deployed
// model returned on 2026-10-10 (recorded from live probes), so each case runs the page on what the model really sent.
const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.csv'
const BY_REGION_PLAN = {
  chartType: 'line',
  groupBy: 'region',
  aggregate: { field: 'id', fn: 'count' },
  title: 'Earthquakes by region',
  explanation: '',
  sortBy: { field: 'id', dir: 'desc' },
}
/** The reply for "asdf qwerty": a default chart by region, no `missing` and no notice, and the model's flag that the question is off the subject. */
const NONSENSE_PLAN = {
  chartType: 'bar',
  groupBy: 'region',
  aggregate: { field: 'mag', fn: 'count' },
  title: 'Earthquake count by region',
  explanation: '',
  sortBy: { field: 'mag', dir: 'desc' },
  aboutData: false,
}

interface Network {
  api: Array<Record<string, unknown>>
  /** What /api/ai answers next. */
  reply: () => Promise<Response>
  feed: () => Promise<Response>
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const planReply = (plan: unknown) => () => Promise.resolve(json({ result: plan, trace: [], usage: {}, model: 'test-model', totalMs: 1 }))

function stubNetwork(): Network {
  const network: Network = {
    api: [],
    reply: planReply(BY_REGION_PLAN),
    feed: () => Promise.resolve(new Response(USGS_WEEK_EXCERPT, { status: 200 })),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === FEED_URL) return network.feed()
      // The stored replay is not there in these tests: the page shows its ordinary empty state.
      if (String(input).startsWith('https://raw.githubusercontent.com/')) return new Response('', { status: 404 })
      network.api.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return network.reply()
    }),
  )
  return network
}

let container: HTMLDivElement
let root: Root

const buttons = (label: string): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll('button')).filter((button) => button.textContent?.trim() === label)

function buttonNamed(label: string): HTMLButtonElement {
  const found = buttons(label)[0]
  if (!found) throw new Error(`No button named "${label}"`)
  return found
}

/** Every button with this label has a short tooltip of its own. */
function expectTooltips(...labels: string[]) {
  for (const label of labels) {
    const found = buttons(label)
    expect(found.length, `a button named "${label}"`).toBeGreaterThan(0)
    for (const button of found) expect(button.getAttribute('title')?.trim() ?? '', `title of "${label}"`).not.toBe('')
  }
}

/** Types into the question box the way a visitor does, so the page's own state follows. */
async function typeQuestion(text: string) {
  const box = container.querySelector<HTMLTextAreaElement>('#question')
  if (!box) throw new Error('No question box')
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => {
    setValue?.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const feedReady = () => vi.waitFor(() => expect(container.textContent).toMatch(/Live data: USGS · fetched \d\d:\d\d/))

async function ask(text: string) {
  await feedReady()
  await typeQuestion(text)
  await act(async () => buttonNamed('Plan and run').click())
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

describe('Dismiss on a failed run', () => {
  it('takes the failed-run box away, and the page is ready for the next question', async () => {
    const network = stubNetwork()
    network.reply = () => Promise.resolve(json({ error: 'The AI provider did not answer in time.' }, 504))
    await act(async () => root.render(<App />))
    await ask('Which region had the most earthquakes?')

    await vi.waitFor(() => expect(container.querySelector('.ds-state--error')?.textContent).toContain('The AI provider did not answer in time.'))
    await act(async () => buttonNamed('Dismiss').click())

    expect(container.querySelector('.ds-state--error')).toBeNull()
    expect(container.textContent).not.toContain('The run failed')
    expect(container.textContent).toContain('Ask a question')
    expect(buttonNamed('Plan and run').disabled).toBe(false)
  })

  it('falls back to the open step when a later question fails, and keeps that step', async () => {
    const network = stubNetwork()
    await act(async () => root.render(<App />))
    await ask('Which region had the most earthquakes?')
    await vi.waitFor(() => expect(container.textContent).toContain('Analysis thread'))

    network.reply = () => Promise.resolve(json({ error: 'The AI provider did not answer in time.' }, 504))
    await typeQuestion('How many earthquakes in total?')
    await act(async () => buttonNamed('Plan and run').click())
    await vi.waitFor(() => expect(container.querySelector('.ds-state--error')).not.toBeNull())

    await act(async () => buttonNamed('Dismiss').click())
    expect(container.querySelector('.ds-state--error')).toBeNull()
    expect(container.textContent).toContain('Analysis thread')
  })
})

describe('a question the model reports as off the subject', () => {
  it('says the data does not answer it, with no chart and no number', async () => {
    const network = stubNetwork()
    network.reply = planReply(NONSENSE_PLAN)
    await act(async () => root.render(<App />))
    await ask('asdf qwerty')

    await vi.waitFor(() => expect(container.textContent).toContain('The data does not answer this question'))
    const box = container.querySelector('.ds-state--partial')
    expect(box?.textContent).toContain('so no number is shown')
    expect(box?.textContent).toContain('Try naming a column, such as region')
    expect(container.querySelector('.ds-chart')).toBeNull()
    expect(container.querySelector('.app-answer')).toBeNull()
    expect(container.textContent).not.toContain('Analysis thread')
    expect(container.querySelector('.app-status')?.textContent).toContain('The data does not answer this question')
    // The model call was made and its cost is in the run; nothing was drawn from it.
    expect(network.api).toHaveLength(1)
  })

  it('still answers a real question on the same data', async () => {
    stubNetwork()
    await act(async () => root.render(<App />))
    await ask('Which region had the most earthquakes?')

    await vi.waitFor(() => expect(container.querySelector('.app-answer')?.textContent).toMatch(/has the highest number of earthquakes: \d+/))
    expect(container.textContent).not.toContain('The data does not answer this question')
  })

  it('is cleared by Dismiss and by the next question', async () => {
    const network = stubNetwork()
    network.reply = planReply(NONSENSE_PLAN)
    await act(async () => root.render(<App />))
    await ask('asdf qwerty')
    await vi.waitFor(() => expect(container.textContent).toContain('The data does not answer this question'))
    await act(async () => buttonNamed('Dismiss').click())
    expect(container.textContent).not.toContain('The data does not answer this question')

    await typeQuestion('Which region had the most earthquakes?')
    network.reply = planReply(BY_REGION_PLAN)
    await act(async () => buttonNamed('Plan and run').click())
    await vi.waitFor(() => expect(container.querySelector('.app-answer')).not.toBeNull())
    expect(container.textContent).not.toContain('The data does not answer this question')
  })
})

describe('tooltips on the action buttons', () => {
  it('covers the controls of the first screen', async () => {
    stubNetwork()
    await act(async () => root.render(<App />))
    await feedReady()
    expectTooltips('Hide', 'Try it', 'Plan and run', 'Fetch again', 'Upload CSV')
    await act(async () => buttonNamed('Hide').click())
    expectTooltips('Show')
  })

  it('covers the controls of a finished answer', async () => {
    stubNetwork()
    await act(async () => root.render(<App />))
    await ask('Which region had the most earthquakes?')
    await vi.waitFor(() => expect(container.textContent).toContain('Analysis thread'))
    expectTooltips('Download CSV', 'Download PNG', 'Refine plan', 'As a bar chart')
  })

  it('covers Stop while a run is waiting', async () => {
    const network = stubNetwork()
    network.reply = () => new Promise<Response>(() => undefined)
    await act(async () => root.render(<App />))
    await ask('Which region had the most earthquakes?')
    await vi.waitFor(() => expect(buttons('Stop').length).toBe(2))
    expectTooltips('Stop')
  })

  it('covers Stop on the step waiting for a follow-up, which sits in the thread and not in the run column', async () => {
    const network = stubNetwork()
    await act(async () => root.render(<App />))
    await ask('Which region had the most earthquakes?')
    await vi.waitFor(() => expect(container.textContent).toContain('Analysis thread'))

    network.reply = () => new Promise<Response>(() => undefined)
    const box = container.querySelector<HTMLInputElement>('#follow-up')
    if (!box) throw new Error('No follow-up box')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, 'only Alaska')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => buttonNamed('Refine plan').click())
    await vi.waitFor(() => expect(container.querySelector('.app-step--pending')).not.toBeNull())
    const inThread = Array.from(container.querySelectorAll<HTMLButtonElement>('.app-step--pending button')).filter((button) => button.textContent?.trim() === 'Stop')
    expect(inThread).toHaveLength(1)
    expect(inThread[0]?.getAttribute('title')?.trim() ?? '').not.toBe('')
  })

  it('covers Try again and Dismiss on a failed run, and Try again and Retry on a failed feed', async () => {
    const network = stubNetwork()
    network.reply = () => Promise.resolve(json({ error: 'The AI provider did not answer in time.' }, 504))
    await act(async () => root.render(<App />))
    await ask('Which region had the most earthquakes?')
    await vi.waitFor(() => expect(container.querySelector('.ds-state--error')).not.toBeNull())
    expectTooltips('Try again', 'Dismiss')
  })

  it('covers the buttons of a failed feed', async () => {
    const network = stubNetwork()
    network.feed = () => Promise.resolve(new Response('', { status: 503 }))
    await act(async () => root.render(<App />))
    await vi.waitFor(() => expect(container.querySelectorAll('[role="alert"]').length).toBeGreaterThan(1))
    expectTooltips('Try again', 'Retry')
  })
})

describe('a file that is not text', () => {
  /** Picks a file the way the browser does: the input reports it and fires change. */
  async function choose(file: File) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('No file input')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  }

  // The first bytes of a PNG: the signature and the IHDR chunk, which holds NUL bytes.
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 0x20, 0, 0, 2, 0x58, 8, 6])

  it('is refused with a clear message, loads nothing and sends nothing to the model', async () => {
    const network = stubNetwork()
    await act(async () => root.render(<App />))
    await feedReady()
    await choose(new File([PNG], 'chart.csv', { type: 'text/csv' }))

    await vi.waitFor(() => expect(container.querySelector('.app-banner[role="alert"]')?.textContent).toContain('"chart.csv" is not a text file'))
    // The banner's own Dismiss button has a tooltip too.
    const dismiss = container.querySelector<HTMLButtonElement>('.app-banner[role="alert"] button')
    expect(dismiss?.textContent?.trim()).toBe('Dismiss')
    expect(dismiss?.getAttribute('title')?.trim() ?? '').not.toBe('')
    expect(container.textContent).not.toContain('Your file')
    expect(Array.from(container.querySelectorAll('select option')).map((option) => option.textContent)).not.toContain('chart.csv')
    expect(network.api).toHaveLength(0)
  })

  it('still loads a UTF-16 CSV that has a byte-order mark, which the browser file reader always decoded', async () => {
    const network = stubNetwork()
    await act(async () => root.render(<App />))
    await feedReady()
    const text = 'city,temp\nZürich,12\nOslo,7\n'
    const bytes = new Uint8Array([0xff, 0xfe, ...[...text].flatMap((char) => [char.charCodeAt(0) & 0xff, char.charCodeAt(0) >> 8])])
    await choose(new File([bytes], 'temps.csv', { type: 'text/csv' }))

    await vi.waitFor(() => expect(Array.from(container.querySelectorAll('select option')).map((option) => option.textContent)).toContain('temps.csv'))
    expect(container.querySelector('.app-banner[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('Zürich')
    expect(network.api).toHaveLength(0)
  })

  it('still loads a Latin-1 CSV with accented letters', async () => {
    stubNetwork()
    await act(async () => root.render(<App />))
    await feedReady()
    // "Zürich" written in Latin-1: the ü is the single byte 0xFC, which is not a control byte.
    const bytes = new Uint8Array([...'city,visits\nZ'].map((char) => char.charCodeAt(0)).concat([0xfc], [...'rich,4\nBern,2\n'].map((char) => char.charCodeAt(0))))
    await choose(new File([bytes], 'visits.csv', { type: 'text/csv' }))

    await vi.waitFor(() => expect(container.textContent).toContain('visits.csv'))
    expect(container.querySelector('.app-banner[role="alert"]')).toBeNull()
  })
})
