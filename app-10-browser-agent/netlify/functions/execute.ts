import Browserbase from '@browserbasehq/sdk'
import { chromium, type Page } from 'playwright-core'
import type { BotStep } from '../../src/types'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const sseHeaders = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
}

const MAX_STEPS = 10
const MAX_STEP_MS = 3_000
const MAX_EXECUTION_MS = 15_000
const MAX_EXCERPT = 4_000
const DEFAULT_ALLOWED_DOMAINS = ['google.com', 'www.google.com', 'flights.google.com']
const VALID_ACTIONS = new Set(['navigate', 'find', 'click', 'type', 'extract', 'verify'])

class ExecutionError extends Error {}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function eventStream(req: Request, run: (send: (event: unknown) => void, isCancelled: () => boolean) => Promise<void>): Response {
  const encoder = new TextEncoder()
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const onAbort = () => { cancelled = true }
      req.signal.addEventListener('abort', onAbort, { once: true })
      const send = (event: unknown) => {
        if (cancelled) throw new ExecutionError('The external browser run was cancelled.')
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      try {
        await run(send, () => cancelled)
      } catch (error) {
        if (!cancelled) {
          send({ type: 'error', message: error instanceof Error ? error.message : 'External browser execution failed.' })
        }
      } finally {
        req.signal.removeEventListener('abort', onAbort)
        if (!cancelled) controller.close()
      }
    },
    cancel() { cancelled = true },
  })
  return new Response(stream, { status: 200, headers: sseHeaders })
}

function allowedDomains(): string[] {
  return (process.env.BROWSERBASE_ALLOWED_DOMAINS ?? DEFAULT_ALLOWED_DOMAINS.join(','))
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
}

function assertAllowedUrl(raw: string, domains: string[]): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ExecutionError('The planned browser URL was invalid.')
  }
  const hostname = url.hostname.toLowerCase()
  const isPrivate = hostname === 'localhost'
    || hostname.endsWith('.local')
    || /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  const permitted = domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
  if (!['http:', 'https:'].includes(url.protocol) || isPrivate || !permitted) {
    throw new ExecutionError(`Navigation blocked by the external-domain policy: ${hostname}`)
  }
  url.username = ''
  url.password = ''
  return url
}

function validateSteps(raw: unknown): BotStep[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STEPS) {
    throw new ExecutionError(`The plan must contain 1-${MAX_STEPS} steps.`)
  }
  const steps = raw.filter((step): step is BotStep => {
    if (!step || typeof step !== 'object') return false
    const value = step as Record<string, unknown>
    return typeof value.action === 'string'
      && VALID_ACTIONS.has(value.action)
      && typeof value.target === 'string'
      && typeof value.thought === 'string'
      && (value.value === undefined || typeof value.value === 'string')
      && (value.url === undefined || typeof value.url === 'string')
  })
  if (steps.length !== raw.length) throw new ExecutionError('The plan contained an invalid browser step.')
  return steps
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ExecutionError('A browser step exceeded its time limit.')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function pageSnapshot(page: Page): Promise<{ url: string; title: string; excerpt: string }> {
  const [title, body] = await Promise.all([
    page.title().catch(() => ''),
    page.locator('body').innerText({ timeout: 1_000 }).catch(() => ''),
  ])
  return { url: page.url(), title, excerpt: body.trim().slice(0, MAX_EXCERPT) }
}

function targetLocator(page: Page, target: string) {
  const normalized = target.toLowerCase()
  if (normalized.includes('search input') || normalized.includes('search field') || normalized.includes('search bar') || normalized === 'search') {
    return page.locator('textarea[name="q"], input[name="q"], input[aria-label*="Search" i]').first()
  }
  if (normalized.includes('search button') || normalized === 'search') {
    return page.getByRole('button', { name: /search/i }).first()
  }
  return page.getByText(target, { exact: false }).first()
}

async function executeStep(page: Page, step: BotStep, domains: string[]): Promise<void> {
  if (step.action === 'navigate') {
    const url = assertAllowedUrl(step.url ?? step.target, domains)
    await withTimeout(page.goto(url.toString(), { waitUntil: 'domcontentloaded' }), MAX_STEP_MS)
    return
  }

  if (step.action === 'type') {
    const value = step.value?.slice(0, 500) ?? ''
    const input = targetLocator(page, step.target)
    if (await input.count() === 0) throw new ExecutionError(`No text input was found for ${step.target}.`)
    await withTimeout(input.fill(value), MAX_STEP_MS)
    return
  }

  if (step.action === 'click') {
    const target = targetLocator(page, step.target)
    if (await target.count() === 0) throw new ExecutionError(`The target was not found: ${step.target}.`)
    await withTimeout(target.click(), MAX_STEP_MS)
    return
  }

  const matchingText = targetLocator(page, step.target)
  if (step.action === 'find') {
    if (await matchingText.count() === 0) {
      const snapshot = await pageSnapshot(page)
      const targetText = step.target.toLowerCase()
      const observed = `${snapshot.title}\n${snapshot.excerpt}`.toLowerCase()
      if (!observed.includes(targetText) && !(targetText.includes('title') && snapshot.title)) {
        throw new ExecutionError(`The target was not found: ${step.target}.`)
      }
    }
    return
  }

  // Extract/verify deliberately use the observed page, never the planner's claimed value.
  if (step.action === 'extract' || step.action === 'verify') await pageSnapshot(page)
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })

  if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
    return jsonError('The external browser service is not configured yet. Please try again later.', 503)
  }

  let steps: BotStep[]
  try {
    const body = await req.json() as { steps?: unknown }
    steps = validateSteps(body.steps)
  } catch (error) {
    return jsonError(error instanceof ExecutionError ? error.message : 'Invalid JSON', 400)
  }

  const domains = allowedDomains()
  try {
    for (const step of steps) {
      if (step.action === 'navigate') assertAllowedUrl(step.url ?? step.target, domains)
    }
  } catch (error) {
    return jsonError(error instanceof ExecutionError ? error.message : 'The planned browser URL was invalid.', 400)
  }

  return eventStream(req, async (send, isCancelled) => {
    const startedAt = Date.now()
    const client = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY, maxRetries: 0, timeout: 7_000 })
    const session = await client.sessions.create({ projectId: process.env.BROWSERBASE_PROJECT_ID })
    send({ type: 'session', sessionId: session.id })

    const browser = await withTimeout(chromium.connectOverCDP(session.connectUrl), 7_000)
    try {
      const context = browser.contexts()[0]
      const page = context?.pages()[0] ?? await context?.newPage()
      if (!page) throw new ExecutionError('Browserbase returned no usable browser page.')

      for (const [index, step] of steps.entries()) {
        if (isCancelled()) throw new ExecutionError('The external browser run was cancelled.')
        if (Date.now() - startedAt > MAX_EXECUTION_MS) throw new ExecutionError('The external browser run reached its time limit.')
        send({ type: 'step_start', index, step, url: page.url() })
        await executeStep(page, step, domains)
        const snapshot = await pageSnapshot(page)
        send({ type: 'step_complete', index, ...snapshot })
      }

      const result = await pageSnapshot(page)
      send({ type: 'result', ...result })
      send({ type: 'done' })
    } finally {
      await browser.close().catch(() => undefined)
    }
  })
}

export const config = { path: '/api/execute' }
