import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiHandler from '../../netlify/functions/ai'
import runHandler from '../../netlify/functions/execute'
import {
  ACTION_MS, CAPTURE_MS, CLEANUP_MS, CLOSE_MS, DETACH_MS, LAUNCH_MS, OPEN_PAGE_MS, PLAN_BUDGET_MS, PLAN_CLIENT_WAIT_MS, RUN_WORST_MS,
  SNAPSHOT_MS, STEP_ACTION_MS, STEP_GATE_MS,
} from '../../src/lib/budget'
import type { BotStep } from '../../src/types'

const mocks = vi.hoisted(() => ({ runStep: vi.fn(), pageSnapshot: vi.fn(), tick: (ms: number): void => void ms, newContext: vi.fn() }))
// The browser is not started. Each slow part of a run takes its longest time on the fake clock instead.
vi.mock('../../netlify/shared/session', () => ({
  launchBrowser: async () => {
    mocks.tick(LAUNCH_MS)
    return { browser: { newContext: mocks.newContext }, executablePath: '/test-only/no-such-chromium', version: '153.0.8010.0', unpackMs: 0 }
  },
  closeBrowser: async () => {
    mocks.tick(CLOSE_MS + CLEANUP_MS)
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
  const tick = (ms: number) => vi.setSystemTime(Date.now() + ms)
  /** A page picture takes its longest time: the screenshot call advances the clock. */
  const cdp = {
    send: async (method: string) => {
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 960, clientHeight: 549 } }
      tick(CAPTURE_MS)
      return { data: Buffer.alloc(1_000, Date.now() % 250).toString('base64') }
    },
    detach: async () => { tick(DETACH_MS) },
  }
  const page = { url: () => 'https://www.google.com/', context: () => ({ newCDPSession: async () => cdp }) }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    mocks.tick = tick
    mocks.newContext.mockResolvedValue({ route: async () => undefined, newPage: async () => { tick(OPEN_PAGE_MS); return page } })
    mocks.pageSnapshot.mockImplementation(async () => {
      tick(SNAPSHOT_MS)
      return { url: 'https://www.google.com/', title: 'Google', excerpt: 'Google Search' }
    })
  })

  type Frame = { type: string; ms?: number; totalMs?: number; message?: string; status?: string; index?: number | null }
  /** Runs the steps. The first `takes` entries are how long each runStep call takes; later calls take `STEP_ACTION_MS`. */
  async function runOf(steps: BotStep[], takes: number[]): Promise<{ frames: Frame[]; elapsed: number }> {
    const queue = [...takes]
    mocks.runStep.mockImplementation(async () => { tick(queue.shift() ?? STEP_ACTION_MS); return 'Found page title.' })
    const start = Date.now()
    const text = await (await runHandler(post('/api/execute', { steps }))).text()
    const frames = text.split('\n\n').filter((record) => record.startsWith('data: ')).map((record) => JSON.parse(record.slice(6)) as Frame)
    return { frames, elapsed: Date.now() - start }
  }

  it('starts a step that begins inside the window', async () => {
    const { frames } = await runOf([NAVIGATE, FIND], [STEP_GATE_MS - SNAPSHOT_MS - CAPTURE_MS - 1])
    expect(frames.at(-1)).toMatchObject({ type: 'done' })
    expect(frames.filter((frame) => frame.type === 'step_complete').map((frame) => frame.status)).toEqual(['ok', 'ok'])
  })

  it('stops before a step that would begin after the window, and says so', async () => {
    const { frames } = await runOf([NAVIGATE, FIND, EXTRACT], [STEP_GATE_MS])
    expect(frames.at(-1)).toEqual({ type: 'error', message: 'The run reached its time limit before every step finished.', index: 1 })
    expect(frames.filter((frame) => frame.type === 'step_complete').map((frame) => frame.status)).toEqual(['ok', 'failed', 'skipped'])
  })

  it('makes the done total the sum of the timed rows', async () => {
    mocks.pageSnapshot.mockResolvedValue({ url: 'https://www.google.com/', title: 'Google', excerpt: 'Google Search' })
    const { frames } = await runOf([NAVIGATE, FIND, EXTRACT], [1_234, 100, 100])
    const rows = frames.filter((frame) => frame.type === 'stage' || frame.type === 'step_complete' || frame.type === 'result')
    const done = frames.at(-1)
    expect(done?.type).toBe('done')
    expect(done?.totalMs).toBe(rows.reduce((sum, frame) => sum + (frame.ms ?? 0), 0))
  })

  it('ends within the worst case the page waits for when every part takes its longest and the window closes on a failed step', async () => {
    // Step 1 begins one millisecond inside the window and takes its longest. Step 2 then meets the end of the window.
    const { frames, elapsed } = await runOf([NAVIGATE, FIND, EXTRACT], [STEP_GATE_MS - SNAPSHOT_MS - CAPTURE_MS - 1, STEP_ACTION_MS])
    expect(frames.at(-1)).toMatchObject({ type: 'error', index: 2 })
    expect(elapsed).toBeGreaterThan(RUN_WORST_MS - 2_000)
    expect(elapsed).toBeLessThanOrEqual(RUN_WORST_MS)
    expect(ACTION_MS).toBeGreaterThan(0)
  })

  it('ends within the worst case when the last step works and the final page is read', async () => {
    const { frames, elapsed } = await runOf([NAVIGATE, FIND], [STEP_GATE_MS - SNAPSHOT_MS - CAPTURE_MS - 1, STEP_ACTION_MS])
    expect(frames.at(-1)).toMatchObject({ type: 'done' })
    expect(elapsed).toBeLessThanOrEqual(RUN_WORST_MS)
  })
})
