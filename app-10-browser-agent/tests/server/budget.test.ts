import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiHandler from '../../netlify/functions/ai'
import runHandler from '../../netlify/functions/execute'
import {
  BODY_TEXT_MS, CAPTURE_MS, CLEANUP_MS, CLOSE_MS, CLOSE_ROW_MS, DETACH_MS, LAUNCH_MS, OPEN_PAGE_MS, PLAN_BUDGET_MS, PLAN_CLIENT_WAIT_MS, RUN_STEPS_END_MS,
  RUN_WORST_MS, SNAPSHOT_MS, TITLE_MS,
} from '../../src/lib/budget'
import type { BotStep } from '../../src/types'

const mocks = vi.hoisted(() => ({ runStep: vi.fn(), pageSnapshot: vi.fn(), tick: (ms: number): void | Promise<void> => void ms, newContext: vi.fn() }))
// The browser is not started. Each slow part of a run takes its longest time on the fake clock instead.
vi.mock('../../netlify/shared/session', () => ({
  launchBrowser: async () => {
    await mocks.tick(LAUNCH_MS)
    return { browser: { newContext: mocks.newContext }, executablePath: '/test-only/no-such-chromium', version: '153.0.8010.0', unpackMs: 0 }
  },
  closeBrowser: async () => {
    await mocks.tick(CLOSE_MS + CLEANUP_MS)
    return { closed: true, diagnostics: {} }
  },
}))
vi.mock('../../netlify/shared/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../netlify/shared/browser')>()),
  runStep: mocks.runStep,
  pageSnapshot: mocks.pageSnapshot,
}))

const ORIGIN = 'https://jdgafx-app-10-browser-agent.netlify.app'
const NAVIGATE: BotStep = { action: 'navigate', target: 'Google home page', thought: 'Open the Google home page.', url: 'https://www.google.com/' }
const FIND: BotStep = { action: 'find', target: 'page title', thought: 'Look for the title.' }
const EXTRACT: BotStep = { action: 'extract', target: 'page title', thought: 'Read the title the browser sees.', value: 'The page title' }
const fetchMock = vi.fn<typeof fetch>()
const originalKey = process.env.OPENROUTER_API_KEY
let nextClient = 1

function post(path: string, body: unknown): Request {
  return new Request(`https://site.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-nf-client-connection-ip': `192.0.2.${nextClient++}` },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.stubEnv('ALLOWED_DOMAINS', '')
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalKey
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('planner: the server answers before the page gives up', () => {
  it('answers a provider that never replies with its own error and trace, at least 3 s before the page stops waiting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined))
    const start = Date.now()
    let answeredAt: number | null = null
    const pending = aiHandler(post('/api/ai', { task: 'Open google.com' })).then((response) => { answeredAt = Date.now() - start; return response })
    await vi.advanceTimersByTimeAsync(PLAN_BUDGET_MS + 5_000)
    const response = await pending
    const body = await response.json() as { error?: string; trace?: unknown[]; unreportedCalls?: number }
    expect(answeredAt).not.toBeNull()
    expect(answeredAt).toBeLessThanOrEqual(PLAN_BUDGET_MS)
    expect(answeredAt! + 3_000).toBeLessThanOrEqual(PLAN_CLIENT_WAIT_MS)
    expect(body.error).toBe('The AI provider did not answer in time')
    expect(body.unreportedCalls).toBe(2)
    expect(body.trace?.length).toBeGreaterThan(1)
  })
})

describe('run: the step window, the done total and the composed worst case', () => {
  // Time is the fake clock's. A part that "takes" a time waits on it, a part that never answers leaves the window to end it, and
  // runOf moves the clock from one timer to the next until the run is over.
  const tick = (ms: number): Promise<void> => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve())
  const cdp = {
    send: async (method: string) => {
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 960, clientHeight: 549 } }
      await tick(costs.capture)
      return { data: Buffer.alloc(1_000, Date.now() % 250).toString('base64') }
    },
    detach: async () => { await tick(DETACH_MS) },
  }
  const page = { url: () => 'https://www.google.com/', context: () => ({ newCDPSession: async () => cdp }) }
  /** What the parts of a run cost. The default is nothing; a test sets the longest each part may take. */
  const costs = { open: 0, capture: 0, read: 0, readWithRegion: 0 }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    Object.assign(costs, { open: 0, capture: 0, read: 0, readWithRegion: 0 })
    mocks.tick = tick
    mocks.newContext.mockResolvedValue({ route: async () => undefined, newPage: async () => { await tick(costs.open); return page } })
    mocks.pageSnapshot.mockImplementation(async (_page: unknown, selector?: string) => {
      await tick(selector ? costs.readWithRegion : costs.read)
      return { url: 'https://www.google.com/', title: 'Google', excerpt: 'Google Search' }
    })
  })

  type Frame = { type: string; ms?: number; totalMs?: number; message?: string; status?: string; index?: number | null }
  /** Runs the steps. The first `takes` entries are how long each runStep call takes (`null`: it never answers); later calls take no time. */
  async function runOf(steps: BotStep[], takes: Array<number | null>): Promise<{ frames: Frame[]; elapsed: number }> {
    const queue = [...takes]
    mocks.runStep.mockImplementation(async () => {
      const take = queue.length > 0 ? queue.shift() : 0
      if (take === null) return new Promise<never>(() => undefined)
      await tick(take ?? 0)
      return 'Found page title.'
    })
    const start = Date.now()
    let over = false
    const reading = (async () => (await runHandler(post('/api/execute', { steps }))).text())().finally(() => { over = true })
    while (!over) await vi.advanceTimersToNextTimerAsync()
    const text = await reading
    const frames = text.split('\n\n').filter((record) => record.startsWith('data: ')).map((record) => JSON.parse(record.slice(6)) as Frame)
    return { frames, elapsed: Date.now() - start }
  }

  const TIME_LIMIT = `The run used its ${RUN_STEPS_END_MS / 1000} second limit before every step finished. Steps that finished keep their pictures. Try a task with fewer steps, or run the plan again.`
  /** The part of the window left when the first step starts, once the browser has started and the page has opened. */
  const FIRST_STEP_LEFT = RUN_STEPS_END_MS - LAUNCH_MS - OPEN_PAGE_MS

  it('runs every step that finishes inside the window', async () => {
    const { frames } = await runOf([NAVIGATE, FIND, EXTRACT], [1_000, 1_000, 1_000])
    expect(frames.at(-1)).toMatchObject({ type: 'done' })
    expect(frames.filter((frame) => frame.type === 'step_complete').map((frame) => frame.status)).toEqual(['ok', 'ok', 'ok'])
  })

  it('ends a step that is still running when the window ends, says so, and skips the steps after it', async () => {
    const { frames, elapsed } = await runOf([NAVIGATE, FIND, EXTRACT], [1_000, null])
    expect(frames.at(-1)).toEqual({ type: 'error', message: TIME_LIMIT, index: 1 })
    expect(frames.filter((frame) => frame.type === 'step_complete').map((frame) => frame.status)).toEqual(['ok', 'failed', 'skipped'])
    expect(elapsed).toBe(RUN_STEPS_END_MS + CLOSE_ROW_MS)
  })

  it('does not start a step when the window has already ended', async () => {
    mocks.tick = (ms) => tick(ms === LAUNCH_MS ? RUN_STEPS_END_MS : ms)
    const { frames } = await runOf([NAVIGATE, FIND], [])
    expect(frames.some((frame) => frame.type === 'step_start')).toBe(false)
    expect(frames.at(-1)).toEqual({ type: 'error', message: TIME_LIMIT, index: 0 })
    expect(mocks.runStep).not.toHaveBeenCalled()
  })

  it('makes the done total the sum of the timed rows', async () => {
    const { frames } = await runOf([NAVIGATE, FIND, EXTRACT], [1_234, 100, 100])
    const rows = frames.filter((frame) => frame.type === 'stage' || frame.type === 'step_complete' || frame.type === 'result')
    const done = frames.at(-1)
    expect(done?.type).toBe('done')
    expect(done?.totalMs).toBe(rows.reduce((sum, frame) => sum + (frame.ms ?? 0), 0))
  })

  it('ends within the worst case when every part takes its longest and a step is still running at the end of the window', async () => {
    Object.assign(costs, { open: OPEN_PAGE_MS - 1, capture: CAPTURE_MS, read: Math.max(TITLE_MS, BODY_TEXT_MS), readWithRegion: SNAPSHOT_MS })
    const { frames, elapsed } = await runOf([NAVIGATE, FIND], [null])
    expect(frames.at(-1)).toMatchObject({ type: 'error', index: 0 })
    expect(elapsed).toBe(RUN_WORST_MS)
  })

  it('ends within the worst case when the last step ends at the end of the window and the final page is read with a region', async () => {
    Object.assign(costs, { open: OPEN_PAGE_MS - 1 })
    const withRegion: BotStep = { ...EXTRACT, selector: '.titleline > a' }
    // The steps' own page reads cost nothing here. Only the final read, the one after the window, takes its longest.
    const instant = async () => ({ url: 'https://www.google.com/', title: 'Google', excerpt: 'Google Search' })
    mocks.pageSnapshot.mockImplementationOnce(instant).mockImplementationOnce(instant)
    mocks.pageSnapshot.mockImplementation(async () => {
      await tick(SNAPSHOT_MS)
      return { url: 'https://www.google.com/', title: 'Google', excerpt: 'Google Search' }
    })
    const { frames, elapsed } = await runOf([NAVIGATE, withRegion], [0, FIRST_STEP_LEFT - 1])
    expect(frames.at(-1)).toMatchObject({ type: 'done' })
    expect(elapsed).toBeLessThanOrEqual(RUN_WORST_MS)
    expect(elapsed).toBeGreaterThan(RUN_WORST_MS - 2_000)
  })
})
