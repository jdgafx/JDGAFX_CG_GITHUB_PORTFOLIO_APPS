import { PLAN_BUDGET_MS } from '../../src/lib/budget'
import { withDeadline } from '../shared/deadline'
import { MAX_TOKENS, MODEL, OPENROUTER_URL } from '../shared/provider'
import { newestModel, servedCheck } from '../shared/newest-model'
import { allowedDomains, hostsIn, isAllowedHost } from '../shared/domains'
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
/** One planner call waits this long, about 1.5 times its healthy p95 with thinking on (about 7 s: 3 s of JSON plus a few hundred reasoning tokens). A call that hangs past it is retried once. */
const CALL_LIMIT_MS = 11_000
/** A retry needs this much budget left, or it would only time out. A thinking call takes about 5 s at the median. */
const MIN_RETRY_MS = 5_000
/** Copy for a provider that timed out or failed on its side. */
const TIMEOUT_COPY = 'The AI provider did not answer in time'
/** The planner's reason for refusing a task is shown to the user, so it is capped. */
const MAX_REFUSAL_CHARS = 300

/** A failure with curated copy the browser may show verbatim. */
class PlanError extends Error {
  readonly status: number
  /** True for a timeout or a dropped connection, the failures worth one more try. 4xx, 429 and 5xx answers are final. */
  readonly transient: boolean
  /** Set when a hang retry was made before this failure. */
  retried = false
  /** The call that failed, so the trace and the totals can account for it. Unset for a failure outside a call. */
  readonly attempt?: Attempt

  constructor(message: string, status: number, transient = false, attempt?: Attempt) {
    super(message)
    this.status = status
    this.transient = transient
    this.attempt = attempt
  }
}

/**
 * One call to the provider.
 * - `answered`: the provider replied with an answer and a usage block, whatever the answer was worth.
 * - `unreported`: the call may have been billed but no usage arrived (a timeout, a dropped connection, an unreadable body, a 5xx).
 * - `rejected`: the provider refused the call with a 4xx status, so nothing was billed.
 */
interface Attempt {
  kind: 'answered' | 'unreported' | 'rejected'
  content: string
  finish: string | null
  model: string | null
  /** Null unless the call was `answered`. */
  usage: UsageReport | null
  ms: number
  /** Curated copy for a call that gave no answer. */
  failure?: string
}

interface ChatResponse {
  model?: unknown
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>
  usage?: Record<string, unknown>
}

// The date is read from the server clock on every request, never once at load, so a warm function
// does not carry yesterday's date past midnight.
function systemPrompt(domains: string[], now: Date = new Date()): string {
  return `You plan browser steps for a bounded agent. Today's date is ${now.toISOString().slice(0, 10)}. Given a user task, return a JSON object with a "steps" array of 2 to 6 steps.

Each step has:
- action: one of "navigate" | "find" | "click" | "type" | "extract" | "verify"
- target: what the step acts on (string). For "type", name the field, for example "search input". For "find" and "click", use words that are visible on the page.
- thought: one or two sentences saying what the step does and why. Never hidden reasoning.
- value?: text to type, or a short description of what to observe (only for "type", "extract" and "verify")
- url?: an absolute https URL, required for "navigate" and omitted for every other action
- selector?: a plain CSS selector for the part of the page to read, only for "extract" and "verify". The browser reports the visible text of the first 10 elements that match it.

Rules:
- Use only these hosts in url: ${domains.join(', ')}.
- If the task names a site that is not in that list, or no page on these hosts can answer it, do not plan steps. Return {"refuse": "<one plain sentence saying why>"} instead. Never open a different site in place of the one the task names, and never label a step with one site while its url opens another.
- Open the page that holds the answer with one "navigate" step whose url goes straight to it. Do not pad the plan with steps the task does not need.
- The last step must be "extract" or "verify". Its value describes what the browser should observe. Never write results, prices or page titles yourself.
- When the answer sits in one part of a page, give the last step a selector so the browser reads only that part. Known selectors: Hacker News front page story titles ".titleline > a"; a Wikipedia article's information box "table.infobox"; a Wikipedia article's opening paragraphs "#mw-content-text .mw-parser-output p"; the Wikipedia main page's featured article blurb "#mp-tfa > p", which starts with the article's name and leaves out the picture caption. Omit the selector when you do not know one, and the browser reads the whole page text.
- Add a year to text you type into a search box or to a url only when the task names one.
- Never claim that a page was visited or that a result was found. The browser run is the source of truth.
- Return ONLY valid JSON. No markdown and no commentary.

Refusal example: {"refuse":"example.com is not an allowed site."}

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

/** The billed figures of every answered call, or null when no call was answered. Each call counts, whatever its answer was worth. */
function aggregateUsage(attempts: Attempt[]): UsageReport | null {
  const billed = attempts.flatMap((attempt) => (attempt.usage ? [attempt.usage] : []))
  if (billed.length === 0) return null
  const pick = (field: keyof UsageReport) => sumOf(billed.map((usage) => usage[field]))
  return {
    prompt_tokens: pick('prompt_tokens'),
    completion_tokens: pick('completion_tokens'),
    total_tokens: pick('total_tokens'),
    cost: pick('cost'),
  }
}

/** A call that gave no answer. Its figures are billed to us only if the provider says so, which it did not. */
function noAnswer(kind: 'unreported' | 'rejected', started: number, failure: string): Attempt {
  return { kind, content: '', finish: null, model: null, usage: null, ms: Date.now() - started, failure }
}

async function callOnce(apiKey: string, task: string, domains: string[], timeoutMs: number): Promise<Attempt> {
  const started = Date.now()
  // One deadline covers the headers and the body read, so a reply that stalls midway ends at the limit.
  type Got = { kind: 'answer'; data: ChatResponse } | { kind: 'http'; status: number } | { kind: 'unreadable' }
  let got: Got
  try {
    got = await withDeadline<Got>(timeoutMs, undefined, async (signal) => {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          // No reasoning override: the model thinks by default, and its thinking counts toward max_tokens.
          // Asks the provider to report tokens and cost, so the run summary can show them.
          usage: { include: true },
          stream: false,
          messages: [
            { role: 'system', content: systemPrompt(domains) },
            { role: 'user', content: `Task: ${task}` },
          ],
        }),
        signal,
      })
      if (!response.ok) return { kind: 'http', status: response.status }
      try {
        return { kind: 'answer', data: await response.json() as ChatResponse }
      } catch (error) {
        if (isTimeout(error)) throw error
        return { kind: 'unreadable' }
      }
    })
  } catch (error) {
    const timedOut = isTimeout(error)
    const message = timedOut ? TIMEOUT_COPY : 'The AI provider could not be reached. Try again in a moment.'
    throw new PlanError(message, timedOut ? 504 : 502, true, noAnswer('unreported', started, message))
  }

  if (got.kind === 'http') {
    console.error(`OpenRouter returned HTTP ${got.status}`)
    const message = providerMessage(got.status)
    // A 4xx refusal bills nothing. A 5xx may have run the model before it failed, and says nothing about it.
    throw new PlanError(message, 502, false, noAnswer(got.status >= 500 ? 'unreported' : 'rejected', started, message))
  }
  if (got.kind === 'unreadable') {
    const message = 'The AI provider returned an unreadable answer. Try again.'
    throw new PlanError(message, 502, false, noAnswer('unreported', started, message))
  }
  const data = got.data

  const choice = data.choices?.[0]
  const content = choice?.message?.content
  const finish = choice?.finish_reason
  return {
    kind: 'answered',
    content: typeof content === 'string' ? content : '',
    finish: typeof finish === 'string' ? finish : null,
    model: typeof data.model === 'string' ? data.model : null,
    usage: usageOf(data.usage),
    ms: Date.now() - started,
  }
}

/**
 * Asks the model once. A second call is made at most once: when the first answer is empty or cut
 * off, or when the first call timed out or dropped and the budget still allows a try.
 * Every call is recorded in `attempts` as it ends, failed ones too, so a throw leaves the whole ledger with the caller.
 * Returns true when the first call timed out or dropped and a second call was made.
 */
async function askModel(apiKey: string, task: string, domains: string[], deadline: number, attempts: Attempt[]): Promise<boolean> {
  let hangRetried = false
  for (let n = 0; n < MAX_ATTEMPTS; n++) {
    const remaining = deadline - Date.now()
    if (n > 0 && remaining < MIN_RETRY_MS) break
    try {
      // The first call gets its own limit so a hang leaves time for the retry. The retry gets what is left.
      attempts.push(await callOnce(apiKey, task, domains, n === 0 ? Math.min(CALL_LIMIT_MS, Math.max(remaining, 1)) : Math.max(remaining, 1)))
    } catch (error) {
      if (error instanceof PlanError && error.attempt) attempts.push(error.attempt)
      if (n === 0 && error instanceof PlanError && error.transient && deadline - Date.now() >= MIN_RETRY_MS) {
        hangRetried = true
        continue
      }
      if (error instanceof PlanError) error.retried = hangRetried
      throw error
    }
    const attempt = attempts[attempts.length - 1]
    if (attempt.content.trim() && attempt.finish !== 'length') break
  }
  return hangRetried
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

/** The planner's one-sentence refusal, or null when it returned a plan. */
function refusalOf(parsed: unknown): string | null {
  const refuse = (parsed as { refuse?: unknown } | null)?.refuse
  return typeof refuse === 'string' && refuse.trim() ? refuse.replace(/\s+/g, ' ').trim().slice(0, MAX_REFUSAL_CHARS) : null
}

function stepsOf(parsed: unknown): unknown {
  return Array.isArray(parsed) ? parsed : (parsed as { steps?: unknown } | null)?.steps
}

/**
 * One trace row per call, so each call shows its own usage. The last call's row says how the run
 * ended (`lastNote`, and `lastStatus` when it was usable). Earlier calls say why they were not enough.
 * With `ended` false the failure came from outside any call, so every call is an earlier one.
 */
function callRows(attempts: Attempt[], lastNote: string, lastStatus: TraceEntry['status'] = 'failed', ended = true): TraceEntry[] {
  return attempts.map((attempt, i): TraceEntry => {
    const isLast = ended && i === attempts.length - 1
    const name = attempts.length > 1 ? `Model call ${i + 1} of ${attempts.length}` : 'Model call'
    // A rejected call bills nothing, so its row carries no usage. An unreported call shows null: "not reported".
    const usage = attempt.kind === 'rejected' ? undefined : attempt.usage
    if (isLast) return { name, status: lastStatus, ms: attempt.ms, detail: lastNote, usage }
    if (attempt.failure) return { name, status: 'failed', ms: attempt.ms, detail: attempt.failure, usage }
    const why = attempt.finish === 'length' ? 'The answer was cut off' : attempt.content.trim() ? 'The answer was not usable' : 'The answer was empty'
    return { name, status: 'failed', ms: attempt.ms, detail: `${why}, so the model was asked again.`, usage }
  })
}

async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin, req.url)
  if (!originAllowed(origin, req.url)) return jsonResponse({ error: 'This page is not allowed to plan tasks.' }, 403, corsHeaders(null, req.url))
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
  // Every call the provider answered or may have billed, kept as it ends. The rows and the totals both come from this list.
  const attempts: Attempt[] = []
  const fail = (message: string, status: number, extra: Record<string, unknown> = {}): Response => {
    const answered = attempts.filter((attempt) => attempt.kind === 'answered')
    return jsonResponse({
      error: message,
      trace,
      totalMs: tracedMs(trace),
      usage: aggregateUsage(attempts),
      unreportedCalls: attempts.filter((attempt) => attempt.kind === 'unreported').length,
      model: answered.at(-1)?.model ?? null,
      ...extra,
    }, status, headers)
  }

  // A site the task names must be on the list before any model or browser call is made.
  const siteCheckStarted = Date.now()
  const outside = hostsIn(task).filter((host) => !isAllowedHost(host, domains))
  if (outside.length > 0) {
    const message = `This task names ${outside.join(', ')}, which is outside the allowed sites: ${domains.join(', ')}.`
    trace.push({ name: 'Check task sites', status: 'failed', ms: Date.now() - siteCheckStarted, detail: message })
    return fail(message, 400)
  }

  const modelStarted = Date.now()
  // The list is read alongside the model call, so it never holds the call up. It never throws, and it is bounded by its own limit.
  const newestP = newestModel()
  let hangRetried: boolean
  try {
    hangRetried = await askModel(apiKey, task, domains, startedAt + PLAN_BUDGET_MS, attempts)
  } catch (error) {
    const failure = error instanceof PlanError
      ? error
      : new PlanError('Something went wrong while planning this task. Please try again.', 500)
    if (!(error instanceof PlanError)) console.error('Planning failed:', error instanceof Error ? error.name : 'unknown error')
    const lastNote = `${failure.retried ? 'Retried once, and the second call failed too. ' : ''}${failure.message}`
    trace.push(...callRows(attempts, lastNote, 'failed', failure.attempt !== undefined))
    // A failure outside any call still leaves one failed row.
    if (!failure.attempt) trace.push({ name: 'Model call', status: 'failed', ms: attempts.length === 0 ? Date.now() - modelStarted : 0, detail: lastNote })
    return fail(failure.message, failure.status)
  }

  const last = attempts[attempts.length - 1]
  const retried = attempts.length > 1
  const retryNote = hangRetried ? 'Retried once: the first call did not answer in time. ' : ''
  const newest = await newestP
  const modelCheck = servedCheck(newest, last.model)
  if (modelCheck === 'mismatch') console.warn(`model mismatch: served ${last.model}, newest ${newest}, requested ${MODEL}`)
  const served = { newestModel: newest, modelCheck }

  if (!last.content.trim() || last.finish === 'length') {
    const cut = last.finish === 'length'
    trace.push(...callRows(attempts, `${retryNote}${retried && !hangRetried ? 'Asked twice. ' : ''}${cut ? 'The answer was cut off.' : 'The answer was empty.'}`))
    return fail(
      cut
        ? 'The model ran out of room before finishing the plan. Try a shorter task.'
        : 'The model returned an empty answer. Try again.',
      502,
      served,
    )
  }

  trace.push(...callRows(attempts, `${retryNote}Served by ${last.model ?? 'a model the provider did not name'}. Finish reason: ${last.finish ?? 'not reported'}.`, 'ok'))

  const parseStarted = Date.now()
  let steps: BotStep[]
  try {
    const parsed: unknown = JSON.parse(extractJson(last.content))
    const refusal = refusalOf(parsed)
    if (refusal) throw new PlanError(`The planner declined this task: ${refusal}`, 400)
    steps = validateSteps(stepsOf(parsed), domains)
  } catch (error) {
    const curated = error instanceof CuratedError || error instanceof PlanError
    const message = curated ? error.message : 'The model returned a plan the agent could not read. Try again.'
    trace.push({ name: 'Parse and validate', status: 'failed', ms: Date.now() - parseStarted, detail: message })
    return fail(message, error instanceof PlanError ? error.status : 502, served)
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
    usage: aggregateUsage(attempts),
    unreportedCalls: attempts.filter((attempt) => attempt.kind === 'unreported').length,
    model: last.model,
    newestModel: newest,
    modelCheck,
    totalMs: tracedMs(trace),
  }, 200, headers)
}

export default async (req: Request): Promise<Response> => {
  try {
    return await handle(req)
  } catch (error) {
    console.error('Planner handler failed:', error instanceof Error ? error.name : 'unknown error')
    return jsonResponse({ error: 'Something went wrong while planning this task. Please try again.' }, 500, corsHeaders(req.headers.get('origin'), req.url))
  }
}
