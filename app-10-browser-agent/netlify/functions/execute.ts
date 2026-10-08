import Browserbase from '@browserbasehq/sdk'
import { chromium, type Browser, type Page } from 'playwright-core'
import type { BotStep, RunEvent, StepAction } from '../../src/types'
import { browserMessage, ExecutionError, pageSnapshot, runStep, withTimeout } from '../shared/browser'
import { allowedDomains } from '../shared/domains'
import { BodyError, clientKey, corsHeaders, jsonResponse, originAllowed, rateLimited, readJson } from '../shared/guard'
import { StepError, validateSteps } from '../shared/steps'

export const config = { path: '/api/execute' }

// Each run is one billable Browserbase session, so the limit is tighter than the planner's.
const RUN_RATE_LIMIT = 10
/** Steps stop starting once the run passes this budget. Streaming past Netlify's 10 s sync cap is a live-check item. */
const MAX_EXECUTION_MS = 15_000
const SESSION_TIMEOUT_MS = 7_000
const CONNECT_TIMEOUT_MS = 7_000

const LABELS: Record<StepAction, string> = {
  navigate: 'Navigate',
  find: 'Find',
  click: 'Click',
  type: 'Type',
  extract: 'Extract',
  verify: 'Verify',
}

type Send = (event: RunEvent) => void

function stepName(step: BotStep): string {
  return `${LABELS[step.action]}: ${step.target}`
}

/**
 * Runs the plan in one Browserbase session and streams each stage as it finishes. The browser
 * is closed and the session released even when a stage fails before the first step.
 */
async function runPlan(send: Send, isCancelled: () => boolean, steps: BotStep[], domains: string[]): Promise<void> {
  const startedAt = Date.now()
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

  try {
    const session = await client.sessions.create({ projectId })
    sessionId = session.id
    send({ type: 'session', sessionId })
    send({ type: 'stage', name: stage, status: 'ok', ms: Date.now() - stageStarted, detail: 'Browser session started.' })

    stage = 'Connect browser'
    stageStarted = Date.now()
    browser = await withTimeout(chromium.connectOverCDP(session.connectUrl), CONNECT_TIMEOUT_MS, 'The browser did not connect in time.')
    const context = browser.contexts()[0]
    const activePage = context?.pages()[0] ?? await context?.newPage()
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
      send({ type: 'step_start', index, name: stepName(step) })
      const detail = await runStep(activePage, step, domains)
      const observed = await pageSnapshot(activePage)
      if ((step.action === 'extract' || step.action === 'verify') && !observed.excerpt) {
        throw new ExecutionError('The page returned no readable text to extract.')
      }
      inStep = false
      completed = index + 1
      send({ type: 'step_complete', index, name: stepName(step), status: 'ok', ms: Date.now() - stepStarted, detail, observed })
    }

    stage = 'Read final page'
    stageStarted = Date.now()
    const finalPage = await pageSnapshot(activePage)
    send({ type: 'result', ms: Date.now() - stageStarted, observed: finalPage })
    send({ type: 'done', totalMs: Date.now() - startedAt })
  } catch (error) {
    const message = browserMessage(error)
    if (inStep) {
      const observed = page ? await pageSnapshot(page).catch(() => undefined) : undefined
      send({
        type: 'step_complete',
        index: completed,
        name: stepName(steps[completed]),
        status: 'failed',
        ms: Date.now() - stepStarted,
        detail: message,
        observed,
      })
    } else {
      send({ type: 'stage', name: stage, status: 'failed', ms: Date.now() - stageStarted, detail: message })
    }
    for (let index = inStep ? completed + 1 : completed; index < steps.length; index++) {
      send({ type: 'step_complete', index, name: stepName(steps[index]), status: 'skipped', ms: 0, detail: 'Not run: an earlier stage failed.' })
    }
    send({ type: 'error', message, index: inStep ? completed : null })
  } finally {
    await browser?.close().catch(() => undefined)
    // Closing the CDP connection does not end the session. Releasing it stops the billing clock.
    if (sessionId) {
      await client.sessions.update(sessionId, { status: 'REQUEST_RELEASE', projectId }).catch(() => undefined)
    }
  }
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
      Connection: 'keep-alive',
    },
  })
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)
  if (!originAllowed(origin)) return new Response('Origin not allowed', { status: 403, headers: corsHeaders(null) })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers })

  if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
    return jsonResponse({ error: 'The external browser service is not configured yet. Please try again later.' }, 503, headers)
  }
  if (rateLimited(`run:${clientKey(req)}`, RUN_RATE_LIMIT)) {
    return jsonResponse({ error: 'Too many browser runs from this connection. Wait a minute and try again.' }, 429, headers)
  }

  const domains = allowedDomains()
  let steps: BotStep[]
  try {
    const body = await readJson(req) as { steps?: unknown }
    steps = validateSteps(body.steps, domains)
  } catch (error) {
    const message = error instanceof StepError || error instanceof BodyError
      ? error.message
      : 'The request could not be read.'
    return jsonResponse({ error: message }, 400, headers)
  }

  return eventStream(req, headers, (send, isCancelled) => runPlan(send, isCancelled, steps, domains))
}
