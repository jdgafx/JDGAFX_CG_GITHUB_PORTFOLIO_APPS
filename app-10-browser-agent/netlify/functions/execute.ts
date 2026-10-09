import type { Browser, BrowserContext, Page } from 'playwright-core'
import { stepLabel } from '../../src/lib/shared'
import type { BotStep, ObservedPage, RunEvent, StepFrame } from '../../src/types'
import { browserMessage, currentHost, ExecutionError, pageSnapshot, runStep, withTimeout } from '../shared/browser'
import { FrameRecorder, type FrameOutcome } from '../shared/frames'
import { allowedDomains, isAllowedHost } from '../shared/domains'
import { clientKey, corsHeaders, CuratedError, jsonResponse, originAllowed, rateLimited, readJson } from '../shared/guard'
import { closeBrowser, launchBrowser } from '../shared/session'
import { validateSteps } from '../shared/steps'

export const config = { path: '/api/execute' }

// Each run starts a browser inside the function, so the limit is tighter than the planner's.
const RUN_RATE_LIMIT = 10
/**
 * No new step starts after this much time since the browser was ready. A streamed function may run 60 s. The worst case
 * is a cold start (3 s), this limit, one last step (up to 15 s) and the close (up to 7 s), which stays under 60 s.
 */
const MAX_EXECUTION_MS = 30_000
/** Largest plan body: ten steps with every field at its limit, in ASCII. */
const MAX_BODY_BYTES = 32_768

/** The browser window size for every run. The picture is this window at two thirds scale. */
const RUN_VIEWPORT = { width: 960, height: 540 }

type Send = (event: RunEvent) => void

/**
 * Snapshots the page only while it sits on an allowed host. Otherwise the run stops before any of
 * the page's content is read, and the message names the host and nothing more. A selector asks for
 * the text of that region of the page.
 */
async function observeAllowed(page: Page, domains: string[], selector?: string): Promise<ObservedPage> {
  const host = currentHost(page)
  if (host === null) throw new ExecutionError('The browser did not reach a web page.')
  if (!isAllowedHost(host, domains)) {
    throw new ExecutionError(`The run stopped. The page moved to ${host}, which is outside the allowed sites.`)
  }
  return pageSnapshot(page, selector)
}

/** A page that looks like an ordinary Chrome, with this browser's own version. */
function userAgentFor(version: string): string {
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version.split('.')[0]}.0.0.0 Safari/537.36`
}

/**
 * Stops a navigation to a host outside the allowlist before any request leaves the browser. The host is
 * remembered so the step can say which site it was. Other requests, such as a page's own images, pass.
 */
async function blockOtherSites(context: BrowserContext, domains: string[], onBlocked: (host: string) => void): Promise<void> {
  await context.route('**/*', (route) => {
    const request = route.request()
    if (request.isNavigationRequest()) {
      let host = ''
      try {
        host = new URL(request.url()).hostname
      } catch {
        // An address that cannot be read is blocked below.
      }
      if (!isAllowedHost(host, domains)) {
        onBlocked(host || 'an unreadable address')
        return route.abort('blockedbyclient')
      }
    }
    return route.continue()
  })
}

/** The frame fields of a step event: the picture, or the reason there is none. */
function frameFields(shot: FrameOutcome): { frame?: StepFrame; frameNote?: string; frameSameAs?: number } {
  if ('frame' in shot) return { frame: shot.frame }
  return 'sameAs' in shot ? { frameSameAs: shot.sameAs } : { frameNote: shot.note }
}

/**
 * Runs the plan in a headless Chromium inside this function and streams each stage as it finishes. The browser is
 * closed even when a stage fails. The final event comes after the close.
 */
async function runPlan(sendRaw: Send, isCancelled: () => boolean, steps: BotStep[], domains: string[]): Promise<void> {
  const startedAt = Date.now()
  // The run total is the sum of the timed rows, so the figures on screen reconcile with the trace.
  let timedMs = 0
  const send: Send = (event) => {
    if ((event.type === 'stage' || event.type === 'step_complete' || event.type === 'result') && typeof event.ms === 'number') timedMs += event.ms
    sendRaw(event)
  }
  let browser: Browser | undefined
  let page: Page | undefined
  let recorder: FrameRecorder | undefined
  let blockedHost: string | undefined
  let stage = 'Launch browser'
  let stageStarted = Date.now()
  let stepStarted = Date.now()
  let completed = 0
  let inStep = false
  let outcome: RunEvent
  let stepsStartedAt: number

  try {
    const launched = await launchBrowser()
    browser = launched.browser
    if (isCancelled()) throw new ExecutionError('The run was stopped.')
    send({ type: 'browser', version: launched.version })
    const context = await browser.newContext({ viewport: RUN_VIEWPORT, userAgent: userAgentFor(launched.version) })
    await blockOtherSites(context, domains, (host) => { blockedHost = host })
    const activePage = await withTimeout(context.newPage(), 7_000, 'The browser did not open a page in time.')
    page = activePage
    const rec = new FrameRecorder(activePage)
    recorder = rec
    const cold = launched.unpackMs > 500 ? ` Unpacked in ${launched.unpackMs.toLocaleString('en-US')} ms.` : ''
    send({ type: 'stage', name: stage, status: 'ok', ms: Date.now() - stageStarted, detail: `Headless Chromium ${launched.version} started in this function.${cold}` })
    stepsStartedAt = Date.now()

    for (const [index, step] of steps.entries()) {
      // A step that cannot start (stopped, or out of time) is the one that fails, so it is marked as such.
      inStep = true
      stepStarted = Date.now()
      if (isCancelled()) throw new ExecutionError('The run was stopped.')
      if (Date.now() - stepsStartedAt > MAX_EXECUTION_MS) {
        throw new ExecutionError('The run reached its time limit before every step finished.')
      }
      send({ type: 'step_start', index, name: stepLabel(step) })
      let stepDetail: string
      try {
        stepDetail = await runStep(activePage, step)
      } catch (error) {
        // A navigation the browser refused to make is reported as the move it was.
        if (blockedHost) throw new ExecutionError(`The run stopped. The page moved to ${blockedHost}, which is outside the allowed sites.`)
        throw error
      }
      // After every step, the host is checked before the page is read.
      const observed = await observeAllowed(activePage, domains, step.selector)
      const detail = step.selector
        ? `${stepDetail} ${observed.region ? `Read the text of ${step.selector}.` : `Nothing matched ${step.selector}, so the page text is shown.`}`
        : stepDetail
      if ((step.action === 'extract' || step.action === 'verify') && !observed.excerpt) {
        throw new ExecutionError('The page returned no readable text to extract.')
      }
      // The picture is taken right after the text was read, so both show the same moment of the page.
      const shot = await rec.capture(index)
      inStep = false
      completed = index + 1
      send({ type: 'step_complete', index, name: stepLabel(step), status: 'ok', ms: Date.now() - stepStarted, detail, observed, ...frameFields(shot) })
    }

    stage = 'Read final page'
    stageStarted = Date.now()
    // A run that ends on a region read shows that region again, not the whole page.
    const finalPage = await observeAllowed(activePage, domains, steps[steps.length - 1].selector)
    send({ type: 'result', ms: Date.now() - stageStarted, observed: finalPage })
    outcome = { type: 'done', totalMs: Date.now() - startedAt }
  } catch (error) {
    const message = browserMessage(error)
    if (inStep) {
      // A page on a disallowed host is not read here either, so its content cannot reach the client.
      const observed = page ? await observeAllowed(page, domains).catch(() => undefined) : undefined
      // The page as it stood when the step failed, and only when it is on an allowed host.
      const shot = observed && recorder ? await recorder.capture(completed) : undefined
      send({
        type: 'step_complete',
        index: completed,
        name: stepLabel(steps[completed]),
        status: 'failed',
        ms: Date.now() - stepStarted,
        detail: message,
        observed,
        ...(shot ? frameFields(shot) : {}),
      })
    } else {
      send({ type: 'stage', name: stage, status: 'failed', ms: Date.now() - stageStarted, detail: message })
    }
    for (let index = inStep ? completed + 1 : completed; index < steps.length; index++) {
      send({ type: 'step_complete', index, name: stepLabel(steps[index]), status: 'skipped', ms: 0, detail: 'Not run: an earlier stage failed.' })
    }
    outcome = { type: 'error', message, index: inStep ? completed : null }
  } finally {
    await recorder?.close()
  }

  // Closing the browser ends its process. The close row always comes last, after the steps that never ran.
  if (browser) {
    const closeStarted = Date.now()
    const closed = await closeBrowser(browser)
    send({
      type: 'stage',
      name: 'Close browser',
      status: closed ? 'ok' : 'failed',
      ms: Date.now() - closeStarted,
      detail: closed ? 'Browser closed.' : 'The browser did not close in time. It ends when this function does.',
    })
  }
  // The total covers the whole run, including the close step above.
  send(outcome.type === 'done' ? { ...outcome, totalMs: timedMs } : outcome)
}

/** Streams RunEvent records as server-sent events and stops work when the client disconnects. */
function eventStream(req: Request, headers: Record<string, string>, run: (send: Send, isCancelled: () => boolean) => Promise<void>): Response {
  const encoder = new TextEncoder()
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const onAbort = () => { cancelled = true }
      req.signal.addEventListener('abort', onAbort, { once: true })
      const send: Send = (event) => {
        if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      try {
        await run(send, () => cancelled)
      } catch (error) {
        send({ type: 'error', message: browserMessage(error), index: null })
      } finally {
        req.signal.removeEventListener('abort', onAbort)
        if (!cancelled) controller.close()
      }
    },
    cancel() { cancelled = true },
  })
  return new Response(stream, {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  })
}

async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)
  if (!originAllowed(origin)) return jsonResponse({ error: 'This page is not allowed to start browser runs.' }, 403, corsHeaders(null))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return jsonResponse({ error: 'Use POST for this request.' }, 405, headers)

  if (rateLimited(`run:${clientKey(req)}`, RUN_RATE_LIMIT)) {
    return jsonResponse({ error: 'Too many browser runs from this connection. Wait a minute and try again.' }, 429, headers)
  }

  const domains = allowedDomains()
  let steps: BotStep[]
  try {
    const body = await readJson(req, MAX_BODY_BYTES) as { steps?: unknown }
    steps = validateSteps(body.steps, domains)
  } catch (error) {
    const message = error instanceof CuratedError ? error.message : 'The request could not be read.'
    return jsonResponse({ error: message }, 400, headers)
  }

  return eventStream(req, headers, (send, isCancelled) => runPlan(send, isCancelled, steps, domains))
}

export default async (req: Request): Promise<Response> => {
  try {
    return await handle(req)
  } catch (error) {
    console.error('Browser handler failed:', error instanceof Error ? error.name : 'unknown error')
    return jsonResponse({ error: 'Something went wrong while starting the browser run. Please try again.' }, 500, corsHeaders(req.headers.get('origin')))
  }
}
