import { MAX_TOKENS, MODEL, OPENROUTER_URL } from '../shared/provider'
import { allowedDomains } from '../shared/domains'
import { clientKey, corsHeaders, CuratedError, jsonResponse, originAllowed, rateLimited, readJson } from '../shared/guard'
import { validateSteps } from '../shared/steps'
import { MAX_TASK_CHARS } from '../../src/lib/constants'
import { usageOf } from '../../src/lib/shared'
import type { BotStep, TraceEntry, UsageReport } from '../../src/types'

export const config = { path: '/api/ai' }

const PLAN_RATE_LIMIT = 20
/** Room for a full task, even one written in four-byte letters, plus its JSON wrapper. */
const MAX_BODY_BYTES = 8_192
const MAX_ATTEMPTS = 2
/** Netlify's synchronous function cap is 10 s. The first call and any retry share this budget. */
const PLAN_BUDGET_MS = 8_500
/** A retry needs this much budget left, or it would only time out. */
const MIN_RETRY_MS = 2_000
/** Copy for a provider that timed out or failed on its side. */
const TIMEOUT_COPY = 'The AI provider did not answer in time'

/** A failure with curated copy the browser may show verbatim. */
class PlanError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

interface Attempt {
  content: string
  finish: string | null
  model: string | null
  usage: UsageReport
  ms: number
}

interface ChatResponse {
  model?: unknown
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>
  usage?: Record<string, unknown>
}

function systemPrompt(domains: string[]): string {
  return `You plan browser steps for a bounded agent. Given a user task, return a JSON object with a "steps" array of 2 to 6 steps.

Each step has:
- action: one of "navigate" | "find" | "click" | "type" | "extract" | "verify"
- target: what the step acts on (string). For "type", name the field, for example "search input". For "find" and "click", use words that are visible on the page.
- thought: one or two sentences saying what the step does and why. Never hidden reasoning.
- value?: text to type, or a short description of what to observe (only for "type", "extract" and "verify")
- url?: an absolute https URL, required for "navigate" and omitted for every other action
- selector?: a plain CSS selector for the part of the page to read, only for "extract" and "verify". The browser reports the visible text of the first 10 elements that match it.

Rules:
- Use only these hosts in url: ${domains.join(', ')}. If the task needs another site, plan the closest step on these hosts and say so in the first thought.
- Open the page that holds the answer with one "navigate" step whose url goes straight to it. Do not pad the plan with steps the task does not need.
- The last step must be "extract" or "verify". Its value describes what the browser should observe. Never write results, prices or page titles yourself.
- When the answer sits in one part of a page, give the last step a selector so the browser reads only that part. Known selectors: Hacker News front page story titles ".titleline > a"; a Wikipedia article's information box "table.infobox"; a Wikipedia article's opening paragraphs "#mw-content-text .mw-parser-output > p"; the Wikipedia main page's featured article "#mp-tfa". Omit the selector when you do not know one, and the browser reads the whole page text.
- Never claim that a page was visited or that a result was found. The browser run is the source of truth.
- Return ONLY valid JSON. No markdown and no commentary.

Example: {"steps":[{"action":"navigate","target":"Google home page","thought":"Open the Google home page.","url":"https://www.google.com/"},{"action":"extract","target":"page title","thought":"Read the title the browser sees.","value":"The page title"}]}`
}

/** Maps a provider status to a plain sentence. The provider body is never shown. */
function providerMessage(status: number): string {
  if (status === 401 || status === 402 || status === 403) return 'The AI provider rejected the key or is out of credit'
  if (status === 429) return 'Rate limited, try again in a minute'
  if (status >= 500) return TIMEOUT_COPY
  return 'The AI provider rejected the request. Try a shorter task, or try again later.'
}

function isTimeout(error: unknown): boolean {
  const thrown = error as { name?: string; cause?: { name?: string } } | null
  const names = [thrown?.name, thrown?.cause?.name]
  return names.includes('TimeoutError') || names.includes('AbortError')
}

/** A total is reported only when every attempt reported its share. Otherwise it is not reported. */
function sumOf(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) return null
  return values.reduce<number>((total, value) => total + (value ?? 0), 0)
}

/** The run figure is the sum of the rows it stands beside, so the two always agree. Gaps between rows are not counted. */
function tracedMs(trace: TraceEntry[]): number {
  return trace.reduce((total, entry) => total + entry.ms, 0)
}

function aggregateUsage(attempts: Attempt[]): UsageReport {
  const pick = (field: keyof UsageReport) => sumOf(attempts.map((attempt) => attempt.usage[field]))
  return {
    prompt_tokens: pick('prompt_tokens'),
    completion_tokens: pick('completion_tokens'),
    total_tokens: pick('total_tokens'),
    cost: pick('cost'),
  }
}

async function callOnce(apiKey: string, task: string, domains: string[], timeoutMs: number): Promise<Attempt> {
  const started = Date.now()
  let response: Response
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // A reasoning model spends the completion budget on hidden reasoning and cuts the JSON short.
        reasoning: { enabled: false },
        // Asks the provider to report tokens and cost, so the run summary can show them.
        usage: { include: true },
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt(domains) },
          { role: 'user', content: `Task: ${task}` },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw isTimeout(error)
      ? new PlanError(TIMEOUT_COPY, 504)
      : new PlanError('The AI provider could not be reached. Try again in a moment.', 502)
  }

  if (!response.ok) {
    console.error(`OpenRouter returned HTTP ${response.status}`)
    throw new PlanError(providerMessage(response.status), 502)
  }

  let data: ChatResponse
  try {
    data = await response.json() as ChatResponse
  } catch (error) {
    throw isTimeout(error)
      ? new PlanError(TIMEOUT_COPY, 504)
      : new PlanError('The AI provider returned an unreadable answer. Try again.', 502)
  }

  const choice = data.choices?.[0]
  const content = choice?.message?.content
  const finish = choice?.finish_reason
  return {
    content: typeof content === 'string' ? content : '',
    finish: typeof finish === 'string' ? finish : null,
    model: typeof data.model === 'string' ? data.model : null,
    usage: usageOf(data.usage),
    ms: Date.now() - started,
  }
}

/** Asks the model once, and once more only when the answer is empty or cut off. */
async function askModel(apiKey: string, task: string, domains: string[], deadline: number): Promise<Attempt[]> {
  const attempts: Attempt[] = []
  for (let n = 0; n < MAX_ATTEMPTS; n++) {
    const remaining = deadline - Date.now()
    if (n > 0 && remaining < MIN_RETRY_MS) break
    const attempt = await callOnce(apiKey, task, domains, Math.max(remaining, 1))
    attempts.push(attempt)
    if (attempt.content.trim() && attempt.finish !== 'length') break
  }
  return attempts
}

/** Pulls the JSON out of a model answer: drops any markdown fence and any prose around it. */
function extractJson(raw: string): string {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  const start = text.search(/[{[]/)
  if (start === -1) return text

  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close && --depth === 0) return text.slice(start, i + 1)
  }

  // Unbalanced: the answer was cut off. Hand back what there is so the parse error stays specific.
  return text.slice(start)
}

function parseSteps(content: string): unknown {
  const parsed: unknown = JSON.parse(extractJson(content))
  return Array.isArray(parsed) ? parsed : (parsed as { steps?: unknown } | null)?.steps
}

async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)
  if (!originAllowed(origin)) return jsonResponse({ error: 'This page is not allowed to plan tasks.' }, 403, corsHeaders(null))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return jsonResponse({ error: 'Use POST for this request.' }, 405, headers)

  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY is not set')
    return jsonResponse({ error: 'The agent service is not configured yet. Please try again later.' }, 503, headers)
  }
  if (rateLimited(`plan:${clientKey(req)}`, PLAN_RATE_LIMIT)) {
    return jsonResponse({ error: 'Too many planning requests from this connection. Wait a minute and try again.' }, 429, headers)
  }

  let task: string
  try {
    const body = await readJson(req, MAX_BODY_BYTES) as { task?: unknown }
    task = typeof body.task === 'string' ? body.task.trim() : ''
  } catch (error) {
    return jsonResponse({ error: error instanceof CuratedError ? error.message : 'The request could not be read.' }, 400, headers)
  }
  if (!task) return jsonResponse({ error: 'Enter a task first.' }, 400, headers)
  if (task.length > MAX_TASK_CHARS) {
    return jsonResponse({ error: `Keep the task under ${MAX_TASK_CHARS} characters.` }, 400, headers)
  }

  const startedAt = Date.now()
  const domains = allowedDomains()
  const trace: TraceEntry[] = [{
    name: 'Request built',
    status: 'ok',
    ms: Date.now() - startedAt,
    detail: `Task of ${task.length} characters. Allowed sites: ${domains.join(', ')}.`,
  }]
  const fail = (message: string, status: number): Response =>
    jsonResponse({ error: message, trace, totalMs: tracedMs(trace) }, status, headers)

  const modelStarted = Date.now()
  let attempts: Attempt[]
  try {
    attempts = await askModel(apiKey, task, domains, startedAt + PLAN_BUDGET_MS)
  } catch (error) {
    const failure = error instanceof PlanError
      ? error
      : new PlanError('Something went wrong while planning this task. Please try again.', 500)
    if (!(error instanceof PlanError)) console.error('Planning failed:', error instanceof Error ? error.name : 'unknown error')
    trace.push({ name: 'Model call', status: 'failed', ms: Date.now() - modelStarted, detail: failure.message })
    return fail(failure.message, failure.status)
  }

  const last = attempts[attempts.length - 1]
  const retried = attempts.length > 1
  const usage = aggregateUsage(attempts)
  const modelMs = attempts.reduce((total, attempt) => total + attempt.ms, 0)

  if (!last.content.trim() || last.finish === 'length') {
    const cut = last.finish === 'length'
    trace.push({
      name: 'Model call',
      status: 'failed',
      ms: modelMs,
      detail: `${retried ? 'Asked twice. ' : ''}${cut ? 'The answer was cut off.' : 'The answer was empty.'}`,
    })
    return fail(
      cut
        ? 'The model ran out of room before finishing the plan. Try a shorter task.'
        : 'The model returned an empty answer. Try again.',
      502,
    )
  }

  trace.push({
    name: 'Model call',
    status: 'ok',
    ms: modelMs,
    detail: `${retried ? 'The first answer was empty or cut off, so the model was asked again. ' : ''}Served by ${last.model ?? 'a model the provider did not name'}. Finish reason: ${last.finish ?? 'not reported'}.`,
  })

  const parseStarted = Date.now()
  let steps: BotStep[]
  try {
    steps = validateSteps(parseSteps(last.content), domains)
  } catch (error) {
    const message = error instanceof CuratedError
      ? error.message
      : 'The model returned a plan the agent could not read. Try again.'
    trace.push({ name: 'Parse and validate', status: 'failed', ms: Date.now() - parseStarted, detail: message })
    return fail(message, 502)
  }
  trace.push({
    name: 'Parse and validate',
    status: 'ok',
    ms: Date.now() - parseStarted,
    detail: `${steps.length} steps. Every address is on an allowed site.`,
  })

  return jsonResponse({
    result: { steps },
    trace,
    usage,
    model: last.model,
    totalMs: tracedMs(trace),
  }, 200, headers)
}

export default async (req: Request): Promise<Response> => {
  try {
    return await handle(req)
  } catch (error) {
    console.error('Planner handler failed:', error instanceof Error ? error.name : 'unknown error')
    return jsonResponse({ error: 'Something went wrong while planning this task. Please try again.' }, 500, corsHeaders(req.headers.get('origin')))
  }
}
