import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import { IDLE_LIMIT_MS, OVERALL_LIMIT_MS, START_LIMIT_MS, planTask, streamRun } from '../../src/lib/api'
import {
  CAPTURE_MS, CLIENT_MARGIN_MS, FAILED_STEP_MS, LAUNCH_MS, PLAN_BUDGET_MS, PLAN_CLIENT_WAIT_MS, PLAN_PLATFORM_CUT_MS,
  RUN_CLIENT_WAIT_MS, RUN_MAX_GAP_MS, RUN_PLATFORM_CUT_MS, RUN_WORST_MS, SNAPSHOT_MS, STEP_ACTION_MS,
} from '../../src/lib/budget'
import { pageSnapshot, runStep } from '../../netlify/shared/browser'
import { FrameRecorder } from '../../netlify/shared/frames'
import { LAUNCH_TIMEOUT_MS } from '../../netlify/shared/session'
import type { BotStep } from '../../src/types'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const never = () => new Promise<never>(() => undefined)

/** Milliseconds of fake time until `work` settles, or null when it is still pending after `maxMs`. */
async function settleTime(work: Promise<unknown>, maxMs: number): Promise<number | null> {
  const start = Date.now()
  let at: number | null = null
  work.then(() => { at = Date.now() - start }, () => { at = Date.now() - start })
  await vi.advanceTimersByTimeAsync(maxMs)
  return at
}

describe('client wait outlasts the server budget: planner', () => {
  it('waits for the planner at least its whole budget plus 3 s, and no longer than the platform allows', () => {
    expect(PLAN_CLIENT_WAIT_MS).toBeGreaterThanOrEqual(PLAN_BUDGET_MS + 3_000)
    expect(PLAN_CLIENT_WAIT_MS).toBeLessThanOrEqual(PLAN_PLATFORM_CUT_MS)
  })

  it('gives the plan request that wait, so the server error with its trace and usage is what the visitor sees', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"The AI provider did not answer in time"}', { status: 504 })))
    await planTask('Open google.com', new AbortController().signal).catch(() => undefined)
    expect(timeout).toHaveBeenCalledWith(PLAN_CLIENT_WAIT_MS)
  })
})

describe('client wait outlasts the server budget: browser run', () => {
  it('waits for a whole run at least the server worst case plus 3 s, under the platform cut', () => {
    expect(OVERALL_LIMIT_MS).toBeGreaterThanOrEqual(RUN_WORST_MS + 3_000)
    expect(OVERALL_LIMIT_MS).toBe(RUN_CLIENT_WAIT_MS)
    expect(OVERALL_LIMIT_MS).toBeLessThanOrEqual(RUN_PLATFORM_CUT_MS)
  })

  it('keeps the server worst case under the platform cut with room to spare', () => {
    expect(RUN_WORST_MS + CLIENT_MARGIN_MS).toBeLessThanOrEqual(RUN_PLATFORM_CUT_MS - 2_000)
  })

  it('waits for the first byte longer than the start takes, and for each quiet stretch longer than the server stays quiet', () => {
    expect(START_LIMIT_MS).toBeGreaterThanOrEqual(LAUNCH_MS + 3_000)
    expect(IDLE_LIMIT_MS).toBeGreaterThanOrEqual(RUN_MAX_GAP_MS + 3_000)
  })

  it('ends a trickling stream at the shared overall wait, not before and not after', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const encoder = new TextEncoder()
    let timer: ReturnType<typeof setInterval> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) { timer = setInterval(() => controller.enqueue(encoder.encode(': keep-alive\n\n')), 5_000) },
      cancel() { clearInterval(timer) },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    const run = streamRun([], () => undefined, new AbortController().signal)
    run.catch(() => undefined)
    expect(await settleTime(run, RUN_CLIENT_WAIT_MS - 1)).toBeNull()
    expect(await settleTime(run, 100)).not.toBeNull()
    await expect(run).rejects.toMatchObject({ message: 'The browser run took longer than expected and was ended. Run the plan again.' })
  })
})

describe('server limits add up to the worst case the page waits for', () => {
  const loc: Record<string, unknown> = {}
  Object.assign(loc, { count: never, click: never, fill: never, inputValue: never, allInnerTexts: never, first: () => loc })
  const hangingPage = {
    url: () => 'https://www.google.com/',
    goto: never,
    title: never,
    evaluate: never,
    locator: () => loc,
    getByText: () => loc,
    getByRole: () => loc,
    context: () => ({ newCDPSession: never }),
  } as unknown as Page

  const steps: BotStep[] = [
    { action: 'navigate', target: 'Google', thought: 'Open it.', url: 'https://www.google.com/' },
    { action: 'find', target: 'results', thought: 'Look.' },
    { action: 'click', target: 'Search button', thought: 'Click.' },
    { action: 'type', target: 'search input', thought: 'Type.', value: 'x' },
  ]

  it.each(steps.map((step) => [step.action, step] as const))('a hung %s step action ends within the step action limit', async (_name, step) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const at = await settleTime(runStep(hangingPage, step), STEP_ACTION_MS + 1_000)
    expect(at).not.toBeNull()
    expect(at).toBeLessThanOrEqual(STEP_ACTION_MS)
  })

  it('a hung page read with a region ends within the snapshot limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const at = await settleTime(pageSnapshot(hangingPage, '.titleline > a'), SNAPSHOT_MS + 1_000)
    expect(at).not.toBeNull()
    expect(at).toBeLessThanOrEqual(SNAPSHOT_MS)
    expect(SNAPSHOT_MS + SNAPSHOT_MS + CAPTURE_MS + STEP_ACTION_MS).toBe(FAILED_STEP_MS)
  })

  it('a hung picture ends within the capture limit with a note', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const outcome = new FrameRecorder(hangingPage).capture(0)
    const at = await settleTime(outcome, CAPTURE_MS + 1_000)
    expect(at).toBe(CAPTURE_MS)
    expect(await outcome).toHaveProperty('note')
  })

  it('a hung picture session lets go within the detach limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const send = async (method: string) => (method === 'Page.getLayoutMetrics'
      ? { cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 960, clientHeight: 549 } }
      : { data: Buffer.alloc(100, 1).toString('base64') })
    const page = { context: () => ({ newCDPSession: async () => ({ send, detach: never }) }) } as unknown as Page
    const recorder = new FrameRecorder(page)
    await recorder.capture(0)
    const at = await settleTime(recorder.close(), 5_000)
    expect(at).not.toBeNull()
    expect(at).toBeLessThanOrEqual(1_000)
  })

  it('starts the browser under the shared launch limit', () => {
    expect(LAUNCH_TIMEOUT_MS).toBe(LAUNCH_MS)
  })
})
