import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/execute'
import { ExecutionError } from '../../netlify/shared/browser'
import type { BotStep } from '../../src/types'

// The browser module, @sparticuz/chromium and Playwright are all mocked. No browser can start.
const mocks = vi.hoisted(() => ({
  executablePath: vi.fn(),
  launch: vi.fn(),
  browserClose: vi.fn(),
  contextRoute: vi.fn(),
  runStep: vi.fn(),
  pageSnapshot: vi.fn(),
}))

vi.mock('@sparticuz/chromium', () => ({ default: { args: ['--test-arg'], executablePath: mocks.executablePath } }))

vi.mock('playwright-core', () => ({
  chromium: { launch: mocks.launch },
}))

vi.mock('../../netlify/shared/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../netlify/shared/browser')>()
  return { ...actual, runStep: mocks.runStep, pageSnapshot: mocks.pageSnapshot }
})

const ORIGIN = 'https://jdgafx-app-10-browser-agent.netlify.app'
const ALLOWED_LIST = 'google.com, www.google.com, flights.google.com, en.wikipedia.org, news.ycombinator.com'
const VERSION = '153.0.8010.0'
const NAVIGATE = { action: 'navigate', target: 'Google home page', thought: 'Open the Google home page.', url: 'https://www.google.com/' }
const EXTRACT = { action: 'extract', target: 'page title', thought: 'Read the title the browser sees.', value: 'The page title' }
const SEARCH = { action: 'verify', target: 'results', thought: 'Check the results.', value: 'Results' }
const CLICK: BotStep = { action: 'click', target: 'Search button', thought: 'Submit the search.' }
const OBSERVED = { url: 'https://www.google.com/', title: 'Google', excerpt: 'Google Search' }
const BLOCKED = 'The run stopped. The page moved to example.com, which is outside the allowed sites.'
const RELEASE_ROW = 'Close browser'
const RELEASED = 'Browser closed.'
const RELEASE_FAILED = 'The browser did not close in time. It ends when this function does.'

const fetchMock = vi.fn<typeof fetch>()
/** The fake CDP session behind every page: it answers layout metrics and screenshots. */
const cdp = { send: vi.fn(), detach: vi.fn() }
/** The address the fake browser's only page shows. A test moves it to stand in for a click or a redirect. */
const pageState = { url: 'https://www.google.com/' }
let nextClient = 1

const JPEG = Buffer.alloc(28_042, 7)

/** Every screenshot is a 28,042-byte JPEG, from a live Hacker News run. `changing` makes each one different, like a page that changes after each step. */
function withPictures(changing: boolean): void {
  let shots = 0
  cdp.send.mockImplementation(async (method: string) => (method === 'Page.getLayoutMetrics'
    ? { cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 960, clientHeight: 549 } }
    : { data: (changing ? Buffer.alloc(28_042, ++shots) : JPEG).toString('base64') }))
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

beforeEach(() => {
  vi.resetAllMocks()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  // The handler logs failures on purpose. The logs are silenced here and checked where it matters.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.stubEnv('ALLOWED_DOMAINS', '')

  pageState.url = 'https://www.google.com/'
  const context = { route: mocks.contextRoute, newPage: async () => page }
  const page = { url: () => pageState.url, context: () => ({ newCDPSession: async () => cdp }) }
  mocks.executablePath.mockResolvedValue('/test-only/no-such-chromium')
  mocks.launch.mockResolvedValue({ version: () => VERSION, newContext: async () => context, close: mocks.browserClose })
  mocks.browserClose.mockResolvedValue(undefined)
  mocks.contextRoute.mockResolvedValue(undefined)
  cdp.detach.mockResolvedValue(undefined)
  withPictures(true)
  mocks.runStep.mockResolvedValue('Opened www.google.com.')
  mocks.pageSnapshot.mockResolvedValue(OBSERVED)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

interface RunOptions {
  method?: string
  origin?: string | null
  ip?: string
  raw?: string
}

function runRequest(body: unknown, options: RunOptions = {}): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-nf-client-connection-ip': options.ip ?? `203.0.113.${nextClient++}`,
  }
  const origin = options.origin === undefined ? ORIGIN : options.origin
  if (origin !== null) headers.origin = origin
  const method = options.method ?? 'POST'
  return new Request('https://site.example/api/execute', {
    method,
    headers,
    body: method === 'GET' ? undefined : (options.raw ?? JSON.stringify(body)),
  })
}

async function errorOf(response: Response): Promise<string | undefined> {
  return ((await response.json()) as { error?: string }).error
}

type Frame = { type: string } & Record<string, unknown>

async function framesOf(response: Response): Promise<Frame[]> {
  const text = await response.text()
  return text
    .split('\n\n')
    .filter((record) => record.startsWith('data: '))
    .map((record) => JSON.parse(record.slice(6)) as Frame)
}

/** The release row of a run, when the run reached its release step. */
function releaseOf(frames: Frame[]): Frame | undefined {
  return frames.find((frame) => frame.type === 'stage' && frame.name === RELEASE_ROW)
}

/** Asserts that no browser was started and no provider was called. */
function expectNoSession(): void {
  expect(mocks.launch).not.toHaveBeenCalled()
  expect(mocks.runStep).not.toHaveBeenCalled()
  expect(mocks.pageSnapshot).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
}

describe('execute function: refusals before any browser starts', () => {
  it('answers 405 with a JSON message to a GET', async () => {
    const response = await handler(runRequest(undefined, { method: 'GET' }))
    expect(response.status).toBe(405)
    expect(await errorOf(response)).toBe('Use POST for this request.')
    expectNoSession()
  })

  it('refuses an origin that is not on the allowlist', async () => {
    const response = await handler(runRequest({ steps: [EXTRACT] }, { origin: 'https://evil.example' }))
    expect(response.status).toBe(403)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(await errorOf(response)).toBe('This page is not allowed to start browser runs.')
    expectNoSession()
  })

  it('answers a body that is not JSON, or is too large, in plain words', async () => {
    const notJson = await handler(runRequest(undefined, { raw: '{"steps":' }))
    expect(notJson.status).toBe(400)
    expect(await errorOf(notJson)).toBe('The request body is not valid JSON.')

    const huge = await handler(runRequest({ steps: [{ ...EXTRACT, value: 'v'.repeat(33_000) }] }))
    expect(huge.status).toBe(400)
    expect(await errorOf(huge)).toBe('The request is too large.')
    expectNoSession()
  })

  it('rejects a plan that is missing, empty, or longer than ten steps', async () => {
    for (const body of [{}, { steps: [] }, { steps: Array.from({ length: 11 }, () => EXTRACT) }]) {
      const response = await handler(runRequest(body))
      expect(response.status).toBe(400)
      expect(await errorOf(response)).toBe('A plan needs 1 to 10 steps.')
    }
    expectNoSession()
  })

  it('rejects an action outside the enum, naming the step', async () => {
    const response = await handler(runRequest({ steps: [EXTRACT, { action: 'download', target: 'file', thought: 'Save it.' }] }))
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe('Step 2 has an action the browser does not support.')
    expectNoSession()
  })

  it('refuses a plan that opens a site outside the allowlist before any browser starts', async () => {
    const response = await handler(runRequest({
      steps: [{ action: 'navigate', target: 'Example', thought: 'Open it.', url: 'https://example.com/' }],
    }))
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe(`Step 1 opens example.com, which is outside the allowed sites: ${ALLOWED_LIST}.`)
    expectNoSession()
  })

  it('refuses a private or metadata address the same way', async () => {
    const response = await handler(runRequest({
      steps: [{ action: 'navigate', target: 'Metadata', thought: 'Open it.', url: 'http://169.254.169.254/latest/meta-data/' }],
    }))
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe(`Step 1 opens 169.254.169.254, which is outside the allowed sites: ${ALLOWED_LIST}.`)
    expectNoSession()
  })

  it('limits runs to 10 a minute from one client, then answers 429', async () => {
    const ip = '198.51.100.200'
    for (let call = 0; call < 10; call++) {
      expect((await handler(runRequest({}, { ip }))).status).toBe(400)
    }
    const limited = await handler(runRequest({}, { ip }))
    expect(limited.status).toBe(429)
    expect(await errorOf(limited)).toBe('Too many browser runs from this connection. Wait a minute and try again.')
    expectNoSession()
  })
})

describe('execute function: a run', () => {
  it('streams browser, stage, step and result frames in order, then closes the browser before done', async () => {
    mocks.runStep
      .mockResolvedValueOnce('Opened www.google.com.')
      .mockResolvedValueOnce('Observed the page for page title.')
    const response = await handler(runRequest({ steps: [NAVIGATE, EXTRACT] }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)

    const frames = await framesOf(response)
    expect(frames.map((frame) => frame.type)).toEqual([
      'browser', 'stage', 'step_start', 'step_complete', 'step_start', 'step_complete', 'result', 'stage', 'done',
    ])
    expect(frames[0]).toEqual({ type: 'browser', version: VERSION })
    expect(frames[1]).toMatchObject({ type: 'stage', name: 'Launch browser', status: 'ok', detail: `Headless Chromium ${VERSION} started in this function.` })
    expect(frames[2]).toEqual({ type: 'step_start', index: 0, name: 'Navigate: Google home page' })
    expect(frames[3]).toMatchObject({ type: 'step_complete', index: 0, status: 'ok', detail: 'Opened www.google.com.', observed: OBSERVED })
    expect(frames[4]).toEqual({ type: 'step_start', index: 1, name: 'Extract: page title' })
    expect(frames[5]).toMatchObject({ type: 'step_complete', index: 1, status: 'ok', detail: 'Observed the page for page title.' })
    expect(frames[6]).toMatchObject({ type: 'result', observed: OBSERVED })
    expect(frames[7]).toMatchObject({ type: 'stage', name: RELEASE_ROW, status: 'ok', detail: RELEASED })
    expect(frames[8]).toMatchObject({ type: 'done' })

    expect(mocks.launch).toHaveBeenCalledWith({ executablePath: '/test-only/no-such-chromium', args: ['--test-arg', '--disk-cache-size=1', '--media-cache-size=1'], headless: true })
    expect(mocks.runStep.mock.calls[0][1]).toEqual(NAVIGATE)
    expect(mocks.pageSnapshot).toHaveBeenCalledTimes(3)
    expect(mocks.browserClose).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says when Chromium had to be unpacked, which is the cold-start cost', async () => {
    let now = 1_700_000_000_000
    mocks.executablePath.mockImplementation(async () => {
      now += 2_700
      return '/test-only/no-such-chromium'
    })
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const frames = await framesOf(await handler(runRequest({ steps: [EXTRACT] })))
    expect(frames.find((frame) => frame.name === 'Launch browser')?.detail).toMatch(/Unpacked in [\d,]+ ms\.$/)
  })

  it('reads the planned region on an extract step and on the final page, and says when nothing matched', async () => {
    const HN = { action: 'navigate', target: 'Hacker News', thought: 'Open it.', url: 'https://news.ycombinator.com/' }
    const TITLES = { action: 'extract', target: 'story titles', thought: 'Read them.', selector: '.titleline > a' }
    const region = { url: 'https://news.ycombinator.com/', title: 'Hacker News', excerpt: 'First story\nSecond story', region: '.titleline > a' }
    const whole = { url: 'https://news.ycombinator.com/', title: 'Hacker News', excerpt: 'Whole page' }
    mocks.runStep.mockResolvedValueOnce('Opened news.ycombinator.com.').mockResolvedValueOnce('Observed the page for story titles.')
    mocks.pageSnapshot.mockResolvedValueOnce(whole).mockResolvedValueOnce(region).mockResolvedValueOnce(region)
    pageState.url = 'https://news.ycombinator.com/'

    const frames = await framesOf(await handler(runRequest({ steps: [HN, TITLES] })))

    expect(frames[5]).toMatchObject({
      type: 'step_complete', index: 1, status: 'ok', observed: region,
      detail: 'Observed the page for story titles. Read the text of .titleline > a.',
    })
    expect(frames[6]).toMatchObject({ type: 'result', observed: region })
    expect(mocks.pageSnapshot.mock.calls.map((call) => call[1])).toEqual([undefined, '.titleline > a', '.titleline > a'])

    mocks.runStep.mockResolvedValueOnce('Opened news.ycombinator.com.').mockResolvedValueOnce('Observed the page for story titles.')
    mocks.pageSnapshot.mockReset().mockResolvedValue(whole)
    const missed = await framesOf(await handler(runRequest({ steps: [HN, TITLES] })))
    expect(missed[5]).toMatchObject({
      status: 'ok', observed: whole,
      detail: 'Observed the page for story titles. Nothing matched .titleline > a, so the page text is shown.',
    })
  })

  it('marks the failing step, skips the rest with the curated message, then closes the browser', async () => {
    mocks.runStep
      .mockResolvedValueOnce('Opened www.google.com.')
      .mockRejectedValueOnce(new ExecutionError('The target was not found: page title.'))
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, EXTRACT, SEARCH] })))

    expect(frames.map((frame) => frame.type)).toEqual([
      'browser', 'stage', 'step_start', 'step_complete', 'step_start', 'step_complete', 'step_complete', 'stage', 'error',
    ])
    expect(frames[5]).toMatchObject({ type: 'step_complete', index: 1, status: 'failed', detail: 'The target was not found: page title.' })
    expect(frames[6]).toMatchObject({ type: 'step_complete', index: 2, status: 'skipped', detail: 'Not run: an earlier stage failed.' })
    expect(releaseOf(frames)).toMatchObject({ status: 'ok', detail: RELEASED })
    expect(frames[8]).toEqual({ type: 'error', message: 'The target was not found: page title.', index: 1 })
    expect(mocks.browserClose).toHaveBeenCalledTimes(1)
  })

  it('reports a browser that cannot start in plain words, with no close row, and keeps internal text out of the stream', async () => {
    mocks.launch.mockRejectedValueOnce(new Error('spawn /tmp/chromium ENOENT libnss3.so'))
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, EXTRACT] })))

    expect(frames.map((frame) => frame.type)).toEqual(['stage', 'step_complete', 'step_complete', 'error'])
    expect(frames[0]).toMatchObject({ name: 'Launch browser', status: 'failed', detail: 'The browser could not start. Try again in a moment.' })
    expect(frames[1]).toMatchObject({ type: 'step_complete', index: 0, status: 'skipped' })
    expect(frames[3]).toEqual({ type: 'error', message: 'The browser could not start. Try again in a moment.', index: null })
    expect(JSON.stringify(frames)).not.toContain('libnss3')
    expect(releaseOf(frames)).toBeUndefined()
  })

  it('stops the run when a click lands on a host outside the allowlist, and reads nothing from that page', async () => {
    mocks.runStep.mockImplementation(async (_page: unknown, step: BotStep) => {
      if (step.action !== 'click') return 'Opened www.google.com.'
      pageState.url = 'https://example.com/landing'
      return 'Clicked Search button.'
    })
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, CLICK, EXTRACT] })))

    expect(frames.map((frame) => frame.type)).toEqual([
      'browser', 'stage', 'step_start', 'step_complete', 'step_start', 'step_complete', 'step_complete', 'stage', 'error',
    ])
    expect(frames[5]).toMatchObject({ type: 'step_complete', index: 1, name: 'Click: Search button', status: 'failed', detail: BLOCKED })
    expect(frames[5]).not.toHaveProperty('observed')
    expect(frames[6]).toMatchObject({ type: 'step_complete', index: 2, status: 'skipped' })
    expect(frames[8]).toEqual({ type: 'error', message: BLOCKED, index: 1 })
    expect(mocks.runStep).toHaveBeenCalledTimes(2)
    expect(mocks.pageSnapshot).toHaveBeenCalledTimes(1)
    expect(mocks.browserClose).toHaveBeenCalledTimes(1)
  })

  it('stops the run when a navigate step is redirected off the allowlist, before the page is read', async () => {
    mocks.runStep.mockImplementation(async () => {
      pageState.url = 'https://example.com/'
      return 'Opened example.com.'
    })
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, EXTRACT] })))

    expect(mocks.runStep).toHaveBeenCalledTimes(1)
    expect(mocks.pageSnapshot).not.toHaveBeenCalled()
    expect(frames[3]).toMatchObject({ type: 'step_complete', index: 0, status: 'failed', detail: BLOCKED })
    expect(frames.at(-1)).toEqual({ type: 'error', message: BLOCKED, index: 0 })
  })

  it('refuses a navigation to another site before any request leaves the browser, and says which site', async () => {
    let route: (r: unknown) => unknown = () => undefined
    mocks.contextRoute.mockImplementation(async (_pattern: string, handlerFn: (r: unknown) => unknown) => { route = handlerFn })
    mocks.runStep.mockImplementation(async () => {
      const abort = vi.fn()
      const cont = vi.fn()
      const request = (url: string, navigation: boolean) => ({ request: () => ({ url: () => url, isNavigationRequest: () => navigation }), abort, continue: cont })
      route(request('https://example.com/landing', true))
      route(request('https://upload.wikimedia.org/logo.png', false))
      expect(abort).toHaveBeenCalledWith('blockedbyclient')
      expect(cont).toHaveBeenCalledTimes(1)
      throw new ExecutionError('The page could not be loaded.')
    })
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, EXTRACT] })))
    expect(frames[3]).toMatchObject({ status: 'failed', detail: BLOCKED })
  })

  it('reports a browser that does not close in time, and still finishes the run', async () => {
    mocks.browserClose.mockRejectedValue(new Error('refused'))
    const frames = await framesOf(await handler(runRequest({ steps: [EXTRACT] })))

    expect(releaseOf(frames)).toMatchObject({ status: 'failed', detail: RELEASE_FAILED })
    expect(frames.at(-1)).toMatchObject({ type: 'done' })
  })

  it('closes a browser that starts after the time limit, as soon as it arrives', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let finishLaunch: (browser: unknown) => void = () => undefined
    mocks.launch.mockReturnValueOnce(new Promise((resolve) => { finishLaunch = resolve }))

    const response = await handler(runRequest({ steps: [EXTRACT] }))
    await settle()
    vi.advanceTimersByTime(12_000)
    const frames = await framesOf(response)
    expect(frames.find((frame) => frame.name === 'Launch browser')).toMatchObject({
      status: 'failed',
      detail: 'The browser did not start in time.',
    })

    const late = { version: () => VERSION, close: vi.fn(async () => undefined) }
    finishLaunch(late)
    vi.useRealTimers()
    await vi.waitFor(() => expect(late.close).toHaveBeenCalledTimes(1))
  })
})

describe('execute function: moves and slow pages', () => {
  it('reports a click that starts a navigation to another site, even though the click itself returned', async () => {
    let route: (r: unknown) => unknown = () => undefined
    mocks.contextRoute.mockImplementation(async (_pattern: string, handlerFn: (r: unknown) => unknown) => { route = handlerFn })
    mocks.runStep.mockImplementation(async (_page: unknown, step: BotStep) => {
      if (step.action === 'click') {
        route({ request: () => ({ url: () => 'https://example.com/out', isNavigationRequest: () => true }), abort: vi.fn(), continue: vi.fn() })
      }
      return 'Done.'
    })
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, CLICK, EXTRACT] })))
    const failed = frames.find((frame) => frame.type === 'step_complete' && frame.status === 'failed')
    // The refused navigation left the page on its allowed site, so the picture of that page is kept.
    expect(failed).toMatchObject({ index: 1, detail: BLOCKED, frame: { width: 640 } })
  })

  it('gives a failed step no picture when the page left the allowed sites after the snapshot', async () => {
    mocks.runStep.mockImplementation(async (_page: unknown, step: BotStep) => {
      if (step.action === 'click') throw new ExecutionError('Search button could not be clicked.')
      return 'Done.'
    })
    mocks.pageSnapshot.mockImplementation(async () => {
      pageState.url = 'chrome-error://chromewebdata/'
      return OBSERVED
    })
    pageState.url = 'https://www.google.com/'
    const frames = await framesOf(await handler(runRequest({ steps: [CLICK, EXTRACT] })))
    const failed = frames.find((frame) => frame.type === 'step_complete' && frame.status === 'failed')
    expect(failed).not.toHaveProperty('frame')
    expect(failed).not.toHaveProperty('frameNote')
  })
})

describe('execute function: step pictures', () => {
  it('sends one 640 px picture with each finished step, taken after the page was read', async () => {
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, EXTRACT] })))
    const done = frames.filter((frame) => frame.type === 'step_complete')
    expect(done).toHaveLength(2)
    for (const step of done) {
      expect(step.frame).toMatchObject({ width: 640, height: 366, bytes: 28_042 })
      expect(step).not.toHaveProperty('frameNote')
    }
    const shot = cdp.send.mock.calls.find(([method]) => method === 'Page.captureScreenshot')?.[1] as { format: string; quality: number; clip: { scale: number; width: number } }
    expect(shot.format).toBe('jpeg')
    expect(shot.clip.width).toBe(960)
    expect(shot.clip.scale).toBeCloseTo(640 / 960)
    expect(cdp.detach).toHaveBeenCalledTimes(1)
  })

  it('sends an unchanged page once and names the earlier step for the repeat', async () => {
    withPictures(false)
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, EXTRACT] })))
    const done = frames.filter((frame) => frame.type === 'step_complete')
    expect(done[0].frame).toMatchObject({ bytes: 28_042 })
    expect(done[1]).not.toHaveProperty('frame')
    expect(done[1]).toMatchObject({ frameSameAs: 0 })
  })

  it('keeps the page picture on a failed step, with its observed text', async () => {
    mocks.runStep.mockImplementation(async (_page: unknown, step: BotStep) => {
      if (step.action === 'click') throw new ExecutionError('The target was not found: Buy tickets.')
      return 'Opened www.google.com.'
    })
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, { ...CLICK, target: 'Buy tickets' }, EXTRACT] })))
    const failed = frames.find((frame) => frame.type === 'step_complete' && frame.status === 'failed')
    expect(failed).toMatchObject({ index: 1, observed: OBSERVED, frame: { width: 640, height: 366, bytes: 28_042 } })
  })

  it('gives a failed step on a disallowed host no picture at all', async () => {
    mocks.runStep.mockImplementation(async (_page: unknown, step: BotStep) => {
      if (step.action === 'click') pageState.url = 'https://example.com/landing'
      return 'Done.'
    })
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, CLICK] })))
    const failed = frames.find((frame) => frame.type === 'step_complete' && frame.status === 'failed')
    expect(failed).not.toHaveProperty('frame')
    expect(failed).not.toHaveProperty('frameNote')
    expect(cdp.send.mock.calls.filter(([method]) => method === 'Page.captureScreenshot')).toHaveLength(1)
  })

  it('says why a step has no picture when the capture fails, and the run still finishes', async () => {
    cdp.send.mockRejectedValue(new Error('target closed'))
    const frames = await framesOf(await handler(runRequest({ steps: [EXTRACT] })))
    expect(frames.find((frame) => frame.type === 'step_complete')).toMatchObject({
      status: 'ok',
      frameNote: 'No picture: the browser could not capture this page in time.',
    })
    expect(frames.at(-1)).toMatchObject({ type: 'done' })
  })
})
