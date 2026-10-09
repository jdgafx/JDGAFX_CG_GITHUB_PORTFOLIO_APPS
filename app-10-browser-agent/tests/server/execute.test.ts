import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/execute'
import { ExecutionError } from '../../netlify/shared/browser'
import type { BotStep } from '../../src/types'

// The browser module, the Browserbase SDK and Playwright are all mocked. No session can open.
const mocks = vi.hoisted(() => ({
  BrowserbaseCtor: vi.fn(),
  sessionsCreate: vi.fn(),
  sessionsUpdate: vi.fn(),
  connectOverCDP: vi.fn(),
  browserClose: vi.fn(),
  runStep: vi.fn(),
  pageSnapshot: vi.fn(),
}))

vi.mock('@browserbasehq/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@browserbasehq/sdk')>()
  class FakeBrowserbase {
    readonly sessions = { create: mocks.sessionsCreate, update: mocks.sessionsUpdate }

    constructor(options: unknown) {
      mocks.BrowserbaseCtor(options)
    }
  }
  return { ...actual, default: FakeBrowserbase }
})

vi.mock('playwright-core', () => ({
  chromium: { connectOverCDP: mocks.connectOverCDP },
}))

vi.mock('../../netlify/shared/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../netlify/shared/browser')>()
  return { ...actual, runStep: mocks.runStep, pageSnapshot: mocks.pageSnapshot }
})

const ORIGIN = 'https://jdgafx-app-10-browser-agent.netlify.app'
const PLACEHOLDER = 'test-only-placeholder'
const ALLOWED_LIST = 'google.com, www.google.com, flights.google.com, en.wikipedia.org, news.ycombinator.com'
const SESSION = 'sess_test_1'
const SESSION_CAP = 120
const NAVIGATE = { action: 'navigate', target: 'Google home page', thought: 'Open the Google home page.', url: 'https://www.google.com/' }
const EXTRACT = { action: 'extract', target: 'page title', thought: 'Read the title the browser sees.', value: 'The page title' }
const SEARCH = { action: 'verify', target: 'results', thought: 'Check the results.', value: 'Results' }
const CLICK: BotStep = { action: 'click', target: 'Search button', thought: 'Submit the search.' }
const OBSERVED = { url: 'https://www.google.com/', title: 'Google', excerpt: 'Google Search' }
const CURATED_UNAVAILABLE = 'The browser run failed before it finished. Try again in a moment.'
const BLOCKED = 'The run stopped. The page moved to example.com, which is outside the allowed sites.'
const RELEASE_ROW = 'Release browser session'
const RELEASED = 'Browser session released.'
const RELEASE_FAILED = 'The browser session could not be released. It may run until Browserbase ends it on its own timeout.'

const fetchMock = vi.fn<typeof fetch>()
const originals = { key: process.env.BROWSERBASE_API_KEY, project: process.env.BROWSERBASE_PROJECT_ID }
/** The address the fake browser's only page shows. A test moves it to stand in for a click or a redirect. */
const pageState = { url: 'https://www.google.com/' }
let nextClient = 1

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

beforeEach(() => {
  vi.resetAllMocks()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  // The handler logs failures on purpose. The logs are silenced here and checked where it matters.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.stubEnv('BROWSERBASE_ALLOWED_DOMAINS', '')
  process.env.BROWSERBASE_API_KEY = PLACEHOLDER
  process.env.BROWSERBASE_PROJECT_ID = PLACEHOLDER

  pageState.url = 'https://www.google.com/'
  const page = { url: () => pageState.url }
  mocks.sessionsCreate.mockResolvedValue({ id: SESSION, connectUrl: 'wss://connect.example/session' })
  mocks.sessionsUpdate.mockResolvedValue({})
  mocks.browserClose.mockResolvedValue(undefined)
  mocks.connectOverCDP.mockResolvedValue({
    contexts: () => [{ pages: () => [page], newPage: vi.fn() }],
    close: mocks.browserClose,
  })
  mocks.runStep.mockResolvedValue('Opened www.google.com.')
  mocks.pageSnapshot.mockResolvedValue(OBSERVED)
})

afterEach(() => {
  if (originals.key === undefined) delete process.env.BROWSERBASE_API_KEY
  else process.env.BROWSERBASE_API_KEY = originals.key
  if (originals.project === undefined) delete process.env.BROWSERBASE_PROJECT_ID
  else process.env.BROWSERBASE_PROJECT_ID = originals.project
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

/** Asserts that no browser module, SDK client, session or provider call was made. */
function expectNoSession(): void {
  expect(mocks.BrowserbaseCtor).not.toHaveBeenCalled()
  expect(mocks.sessionsCreate).not.toHaveBeenCalled()
  expect(mocks.connectOverCDP).not.toHaveBeenCalled()
  expect(mocks.runStep).not.toHaveBeenCalled()
  expect(mocks.pageSnapshot).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
}

describe('execute function: refusals before any session opens', () => {
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

  it('answers 503 with the configuration copy when the Browserbase key or project is blank', async () => {
    process.env.BROWSERBASE_API_KEY = ''
    const noKey = await handler(runRequest({ steps: [EXTRACT] }))
    expect(noKey.status).toBe(503)
    expect(await errorOf(noKey)).toBe('The external browser service is not configured yet. Please try again later.')

    process.env.BROWSERBASE_API_KEY = PLACEHOLDER
    process.env.BROWSERBASE_PROJECT_ID = ''
    const noProject = await handler(runRequest({ steps: [EXTRACT] }))
    expect(noProject.status).toBe(503)
    expect(await errorOf(noProject)).toBe('The external browser service is not configured yet. Please try again later.')
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

  it('refuses a plan that opens a site outside the allowlist before any session opens', async () => {
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
  it('streams session, stage, step and result frames in order, then releases the session before done', async () => {
    mocks.runStep
      .mockResolvedValueOnce('Opened www.google.com.')
      .mockResolvedValueOnce('Observed the page for page title.')
    const response = await handler(runRequest({ steps: [NAVIGATE, EXTRACT] }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)

    const frames = await framesOf(response)
    expect(frames.map((frame) => frame.type)).toEqual([
      'session', 'stage', 'stage', 'step_start', 'step_complete', 'step_start', 'step_complete', 'result', 'stage', 'done',
    ])
    expect(frames[0]).toEqual({ type: 'session', sessionId: SESSION })
    expect(frames[1]).toMatchObject({ type: 'stage', name: 'Open browser session', status: 'ok', detail: 'Browser session started.' })
    expect(frames[2]).toMatchObject({ type: 'stage', name: 'Connect browser', status: 'ok', detail: 'Connected to the browser.' })
    expect(frames[3]).toEqual({ type: 'step_start', index: 0, name: 'Navigate: Google home page' })
    expect(frames[4]).toMatchObject({ type: 'step_complete', index: 0, status: 'ok', detail: 'Opened www.google.com.', observed: OBSERVED })
    expect(frames[5]).toEqual({ type: 'step_start', index: 1, name: 'Extract: page title' })
    expect(frames[6]).toMatchObject({ type: 'step_complete', index: 1, status: 'ok', detail: 'Observed the page for page title.' })
    expect(frames[7]).toMatchObject({ type: 'result', observed: OBSERVED })
    expect(frames[8]).toMatchObject({ type: 'stage', name: RELEASE_ROW, status: 'ok', detail: RELEASED })
    expect(frames[9]).toMatchObject({ type: 'done' })

    expect(mocks.BrowserbaseCtor).toHaveBeenCalledWith(expect.objectContaining({ apiKey: PLACEHOLDER, maxRetries: 0 }))
    expect(mocks.sessionsCreate).toHaveBeenCalledWith({ projectId: PLACEHOLDER, api_timeout: SESSION_CAP })
    expect(mocks.runStep.mock.calls[0][1]).toEqual(NAVIGATE)
    expect(mocks.pageSnapshot).toHaveBeenCalledTimes(3)
    expect(mocks.browserClose).toHaveBeenCalledTimes(1)
    expect(mocks.sessionsUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.sessionsUpdate).toHaveBeenCalledWith(SESSION, { status: 'REQUEST_RELEASE', projectId: PLACEHOLDER })
    expect(fetchMock).not.toHaveBeenCalled()
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

    expect(frames[6]).toMatchObject({
      type: 'step_complete', index: 1, status: 'ok', observed: region,
      detail: 'Observed the page for story titles. Read the text of .titleline > a.',
    })
    expect(frames[7]).toMatchObject({ type: 'result', observed: region })
    expect(mocks.pageSnapshot.mock.calls.map((call) => call[1])).toEqual([undefined, '.titleline > a', '.titleline > a'])

    mocks.runStep.mockResolvedValueOnce('Opened news.ycombinator.com.').mockResolvedValueOnce('Observed the page for story titles.')
    mocks.pageSnapshot.mockReset().mockResolvedValue(whole)
    const missed = await framesOf(await handler(runRequest({ steps: [HN, TITLES] })))
    expect(missed[6]).toMatchObject({
      status: 'ok', observed: whole,
      detail: 'Observed the page for story titles. Nothing matched .titleline > a, so the page text is shown.',
    })
  })

  it('marks the failing step, skips the rest with the curated message, then releases the session', async () => {
    mocks.runStep
      .mockResolvedValueOnce('Opened www.google.com.')
      .mockRejectedValueOnce(new ExecutionError('The target was not found: page title.'))
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, EXTRACT, SEARCH] })))

    expect(frames.map((frame) => frame.type)).toEqual([
      'session', 'stage', 'stage', 'step_start', 'step_complete', 'step_start', 'step_complete', 'step_complete', 'stage', 'error',
    ])
    expect(frames[6]).toMatchObject({ type: 'step_complete', index: 1, status: 'failed', detail: 'The target was not found: page title.' })
    expect(frames[7]).toMatchObject({ type: 'step_complete', index: 2, status: 'skipped', detail: 'Not run: an earlier stage failed.' })
    expect(releaseOf(frames)).toMatchObject({ status: 'ok', detail: RELEASED })
    expect(frames[9]).toEqual({ type: 'error', message: 'The target was not found: page title.', index: 1 })
    expect(mocks.browserClose).toHaveBeenCalledTimes(1)
    expect(mocks.sessionsUpdate).toHaveBeenCalledWith(SESSION, { status: 'REQUEST_RELEASE', projectId: PLACEHOLDER })
  })

  it('releases the session when the browser cannot be reached, and keeps the provider text out of the stream', async () => {
    mocks.connectOverCDP.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.9.8.7:9222'))
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, EXTRACT] })))

    expect(frames.map((frame) => frame.type)).toEqual(['session', 'stage', 'stage', 'step_complete', 'step_complete', 'stage', 'error'])
    expect(frames[2]).toMatchObject({ name: 'Connect browser', status: 'failed', detail: CURATED_UNAVAILABLE })
    expect(frames[3]).toMatchObject({ type: 'step_complete', index: 0, status: 'skipped' })
    expect(releaseOf(frames)).toMatchObject({ status: 'ok', detail: RELEASED })
    expect(frames[6]).toEqual({ type: 'error', message: CURATED_UNAVAILABLE, index: null })
    expect(JSON.stringify(frames)).not.toContain('ECONNREFUSED')
    expect(console.error).toHaveBeenCalledWith('Browser run failed:', 'Error')
    expect(mocks.browserClose).not.toHaveBeenCalled()
    expect(mocks.sessionsUpdate).toHaveBeenCalledWith(SESSION, { status: 'REQUEST_RELEASE', projectId: PLACEHOLDER })
  })

  it('does not release a session that was never created', async () => {
    mocks.sessionsCreate.mockRejectedValueOnce(new Error('network'))
    const frames = await framesOf(await handler(runRequest({ steps: [EXTRACT] })))

    expect(frames.map((frame) => frame.type)).toEqual(['stage', 'step_complete', 'error'])
    expect(frames[0]).toMatchObject({ name: 'Open browser session', status: 'failed', detail: CURATED_UNAVAILABLE })
    expect(mocks.connectOverCDP).not.toHaveBeenCalled()
    expect(mocks.sessionsUpdate).not.toHaveBeenCalled()
  })

  it('stops the run when a click lands on a host outside the allowlist, and reads nothing from that page', async () => {
    mocks.runStep.mockImplementation(async (_page: unknown, step: BotStep) => {
      if (step.action !== 'click') return 'Opened www.google.com.'
      pageState.url = 'https://example.com/landing'
      return 'Clicked Search button.'
    })
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, CLICK, EXTRACT] })))

    expect(frames.map((frame) => frame.type)).toEqual([
      'session', 'stage', 'stage', 'step_start', 'step_complete', 'step_start', 'step_complete', 'step_complete', 'stage', 'error',
    ])
    expect(frames[6]).toMatchObject({ type: 'step_complete', index: 1, name: 'Click: Search button', status: 'failed', detail: BLOCKED })
    expect(frames[6]).not.toHaveProperty('observed')
    expect(frames[7]).toMatchObject({ type: 'step_complete', index: 2, status: 'skipped' })
    expect(frames[9]).toEqual({ type: 'error', message: BLOCKED, index: 1 })
    expect(mocks.runStep).toHaveBeenCalledTimes(2)
    expect(mocks.pageSnapshot).toHaveBeenCalledTimes(1)
    expect(mocks.browserClose).toHaveBeenCalledTimes(1)
    expect(mocks.sessionsUpdate).toHaveBeenCalledWith(SESSION, { status: 'REQUEST_RELEASE', projectId: PLACEHOLDER })
  })

  it('stops the run when a navigate step is redirected off the allowlist, before the page is read', async () => {
    mocks.runStep.mockImplementation(async () => {
      pageState.url = 'https://example.com/'
      return 'Opened example.com.'
    })
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, EXTRACT] })))

    expect(mocks.runStep).toHaveBeenCalledTimes(1)
    expect(mocks.pageSnapshot).not.toHaveBeenCalled()
    expect(frames[4]).toMatchObject({ type: 'step_complete', index: 0, status: 'failed', detail: BLOCKED })
    expect(frames.at(-1)).toEqual({ type: 'error', message: BLOCKED, index: 0 })
  })

  it('retries a failed release once, and reports the release as ok when the retry works', async () => {
    mocks.sessionsUpdate.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce({})
    const frames = await framesOf(await handler(runRequest({ steps: [EXTRACT] })))

    expect(mocks.sessionsUpdate).toHaveBeenCalledTimes(2)
    expect(releaseOf(frames)).toMatchObject({ status: 'ok', detail: RELEASED })
    expect(frames.at(-1)).toMatchObject({ type: 'done' })
  })

  it('reports a release that fails twice, keeps the session id out of the stream, and logs it on the server', async () => {
    mocks.sessionsUpdate.mockRejectedValue(new Error('refused'))
    const frames = await framesOf(await handler(runRequest({ steps: [EXTRACT] })))

    expect(mocks.sessionsUpdate).toHaveBeenCalledTimes(2)
    expect(releaseOf(frames)).toMatchObject({ status: 'failed', detail: RELEASE_FAILED })
    expect(JSON.stringify(releaseOf(frames))).not.toContain(SESSION)
    expect(console.error).toHaveBeenCalledWith(`Browserbase session ${SESSION} could not be released`)
    expect(frames.at(-1)).toMatchObject({ type: 'done' })
  })

  it('closes a browser that connects after the time limit, as soon as it arrives', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let finishConnect: (browser: unknown) => void = () => undefined
    mocks.connectOverCDP.mockReturnValueOnce(new Promise((resolve) => { finishConnect = resolve }))

    const response = await handler(runRequest({ steps: [EXTRACT] }))
    await settle()
    vi.advanceTimersByTime(7_000)
    const frames = await framesOf(response)
    expect(frames.find((frame) => frame.name === 'Connect browser')).toMatchObject({
      status: 'failed',
      detail: 'The browser did not connect in time.',
    })

    const late = { close: vi.fn(async () => undefined) }
    finishConnect(late)
    await settle()
    expect(late.close).toHaveBeenCalledTimes(1)
  })
})

describe('execute function: step pictures', () => {
  // A JPEG size taken from a live Hacker News run: 28,042 bytes at 640 x 366.
  const JPEG = Buffer.alloc(28_042, 7)
  const send = vi.fn()
  const detach = vi.fn()

  /** `changing` gives every capture different bytes, like a page that changes after each step. */
  function withCdpPage(changing = true): void {
    let shots = 0
    const page = {
      url: () => pageState.url,
      setViewportSize: vi.fn().mockResolvedValue(undefined),
      context: () => ({ newCDPSession: async () => ({ send, detach }) }),
    }
    mocks.connectOverCDP.mockResolvedValue({ contexts: () => [{ pages: () => [page], newPage: vi.fn() }], close: mocks.browserClose })
    send.mockImplementation(async (method: string) => (method === 'Page.getLayoutMetrics'
      ? { cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 960, clientHeight: 549 } }
      : { data: (changing ? Buffer.alloc(28_042, ++shots) : JPEG).toString('base64') }))
    detach.mockResolvedValue(undefined)
  }

  it('sends one 640 px picture with each finished step, taken after the page was read', async () => {
    withCdpPage()
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, EXTRACT] })))
    const done = frames.filter((frame) => frame.type === 'step_complete')
    expect(done).toHaveLength(2)
    for (const step of done) {
      expect(step.frame).toMatchObject({ width: 640, height: 366, bytes: 28_042 })
      expect(step).not.toHaveProperty('frameNote')
    }
    const shot = send.mock.calls.find(([method]) => method === 'Page.captureScreenshot')?.[1] as { format: string; quality: number; clip: { scale: number; width: number } }
    expect(shot.format).toBe('jpeg')
    expect(shot.clip.width).toBe(960)
    expect(shot.clip.scale).toBeCloseTo(640 / 960)
    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('sends an unchanged page once and names the earlier step for the repeat', async () => {
    withCdpPage(false)
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, EXTRACT] })))
    const done = frames.filter((frame) => frame.type === 'step_complete')
    expect(done[0].frame).toMatchObject({ bytes: 28_042 })
    expect(done[1]).not.toHaveProperty('frame')
    expect(done[1]).toMatchObject({ frameSameAs: 0 })
  })

  it('keeps the page picture on a failed step, with its observed text', async () => {
    withCdpPage()
    mocks.runStep.mockImplementation(async (_page: unknown, step: BotStep) => {
      if (step.action === 'click') throw new ExecutionError('The target was not found: Buy tickets.')
      return 'Opened www.google.com.'
    })
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, { ...CLICK, target: 'Buy tickets' }, EXTRACT] })))
    const failed = frames.find((frame) => frame.type === 'step_complete' && frame.status === 'failed')
    expect(failed).toMatchObject({ index: 1, observed: OBSERVED, frame: { width: 640, height: 366, bytes: 28_042 } })
  })

  it('gives a failed step on a disallowed host no picture at all', async () => {
    withCdpPage()
    mocks.runStep.mockImplementation(async (_page: unknown, step: BotStep) => {
      if (step.action === 'click') pageState.url = 'https://example.com/landing'
      return 'Done.'
    })
    const frames = await framesOf(await handler(runRequest({ steps: [NAVIGATE, CLICK] })))
    const failed = frames.find((frame) => frame.type === 'step_complete' && frame.status === 'failed')
    expect(failed).not.toHaveProperty('frame')
    expect(failed).not.toHaveProperty('frameNote')
    expect(send.mock.calls.filter(([method]) => method === 'Page.captureScreenshot')).toHaveLength(1)
  })

  it('says why a step has no picture when the capture fails, and the run still finishes', async () => {
    withCdpPage()
    send.mockRejectedValue(new Error('target closed'))
    const frames = await framesOf(await handler(runRequest({ steps: [EXTRACT] })))
    expect(frames.find((frame) => frame.type === 'step_complete')).toMatchObject({
      status: 'ok',
      frameNote: 'No picture: the browser could not capture this page in time.',
    })
    expect(frames.at(-1)).toMatchObject({ type: 'done' })
  })
})
