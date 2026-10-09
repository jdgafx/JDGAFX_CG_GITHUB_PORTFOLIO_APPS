import Browserbase from '@browserbasehq/sdk'
import type { Browser, Page } from 'playwright-core'
import { stepLabel } from '../../src/lib/shared'
import type { BotStep, ObservedPage, RunEvent } from '../../src/types'
import { browserMessage, currentHost, ExecutionError, pageSnapshot, runStep, withTimeout } from '../shared/browser'
import { allowedDomains, isAllowedHost } from '../shared/domains'
import { clientKey, corsHeaders, CuratedError, jsonResponse, originAllowed, rateLimited, readJson } from '../shared/guard'
import { BROWSER_TIMEOUT_MS, connectBrowser, releaseSession } from '../shared/session'
import { validateSteps } from '../shared/steps'

export const config = { path: '/api/execute' }

// Each run is one billable Browserbase session, so the limit is tighter than the planner's.
const RUN_RATE_LIMIT = 10
/** No new step starts after this much run time. Streaming past Netlify's 10 s sync cap is a live-check item. */
const MAX_EXECUTION_MS = 15_000
/** Limit on each Browserbase API request. Creating a session is never retried, so a timeout there is final. */
const SESSION_TIMEOUT_MS = 7_000
/** Seconds after which Browserbase ends the session by itself, so a session that is never released still stops. */
const SESSION_CAP_SECONDS = 120
/** Largest plan body: ten steps with every field at its limit, in ASCII. */
const MAX_BODY_BYTES = 32_768

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

/**
 * Runs the plan in one Browserbase session and streams each stage as it finishes. The browser is
 * closed and the session released even when a stage fails. The final event comes after the release.
 */
async function runPlan(sendRaw: Send, isCancelled: () => boolean, steps: BotStep[], domains: string[]): Promise<void> {
  const startedAt = Date.now()
  // The run total is the sum of the timed rows, so the figures on screen reconcile with the trace.
  let timedMs = 0
  const send: Send = (event) => {
    if ((event.type === 'stage' || event.type === 'step_complete' || event.type === 'result') && typeof event.ms === 'number') timedMs += event.ms
    sendRaw(event)
  }
  const projectId = process.env.BROWSERBASE_PROJECT_ID ?? ''
  const client = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY, maxRetries: 0, timeout: SESSION_TIMEOUT_MS })
  let sessionId: string | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  let stage = 'Open browser session'
  let stageStarted = Date.now()
  let stepStarted = Date.now()
  let completed = 0
  let inStep = false
  let outcome: RunEvent

  try {
    const session = await client.sessions.create({ projectId, api_timeout: SESSION_CAP_SECONDS })
    sessionId = session.id
    send({ type: 'session', sessionId })
    send({ type: 'stage', name: stage, status: 'ok', ms: Date.now() - stageStarted, detail: 'Browser session started.' })

    stage = 'Connect browser'
    stageStarted = Date.now()
    browser = await connectBrowser(session.connectUrl)
    const context = browser.contexts()[0]
    const activePage = context?.pages()[0]
      ?? (context ? await withTimeout(context.newPage(), BROWSER_TIMEOUT_MS, 'The browser did not open a page in time.') : undefined)
    if (!activePage) throw new ExecutionError('Browserbase returned no usable browser page.')
    page = activePage
    send({ type: 'stage', name: stage, status: 'ok', ms: Date.now() - stageStarted, detail: 'Connected to the browser.' })

    for (const [index, step] of steps.entries()) {
      // A step that cannot start (stopped, or out of time) is the one that fails, so it is marked as such.
      inStep = true
      stepStarted = Date.now()
      if (isCancelled()) throw new ExecutionError('The run was stopped.')
      if (Date.now() - startedAt > MAX_EXECUTION_MS) {
        throw new ExecutionError('The run reached its time limit before every step finished.')
      }
      send({ type: 'step_start', index, name: stepLabel(step) })
      const stepDetail = await runStep(activePage, step)
      // After every step, the host is checked before the page is read.
      const observed = await observeAllowed(activePage, domains, step.selector)
      const detail = step.selector
        ? `${stepDetail} ${observed.region ? `Read the text of ${step.selector}.` : `Nothing matched ${step.selector}, so the page text is shown.`}`
        : stepDetail
      if ((step.action === 'extract' || step.action === 'verify') && !observed.excerpt) {
        throw new ExecutionError('The page returned no readable text to extract.')
      }
      inStep = false
      completed = index + 1
      send({ type: 'step_complete', index, name: stepLabel(step), status: 'ok', ms: Date.now() - stepStarted, detail, observed })
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
      send({
        type: 'step_complete',
        index: completed,
        name: stepLabel(steps[completed]),
        status: 'failed',
        ms: Date.now() - stepStarted,
        detail: message,
        observed,
      })
    } else {
      send({ type: 'stage', name: stage, status: 'failed', ms: Date.now() - stageStarted, detail: message })
    }
    for (let index = inStep ? completed + 1 : completed; index < steps.length; index++) {
      send({ type: 'step_complete', index, name: stepLabel(steps[index]), status: 'skipped', ms: 0, detail: 'Not run: an earlier stage failed.' })
    }
    outcome = { type: 'error', message, index: inStep ? completed : null }
  } finally {
    if (browser) await withTimeout(browser.close(), BROWSER_TIMEOUT_MS, 'The browser did not close in time.').catch(() => undefined)
  }

  // Closing the CDP connection does not end the session. Releasing it stops the billing clock.
  if (sessionId) {
    const releaseStarted = Date.now()
    const released = await releaseSession(client, sessionId, projectId)
    send({
      type: 'stage',
      name: 'Release browser session',
      status: released ? 'ok' : 'failed',
      ms: Date.now() - releaseStarted,
      detail: released
        ? 'Browser session released.'
        : 'The browser session could not be released. It may run until Browserbase ends it on its own timeout.',
    })
  }
  // The total covers the whole run, including the release step above.
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

  if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
    return jsonResponse({ error: 'The external browser service is not configured yet. Please try again later.' }, 503, headers)
  }
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
