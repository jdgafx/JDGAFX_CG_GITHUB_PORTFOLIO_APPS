import { validateQueryPlan } from '../../src/lib/queryPlan'
import type { QueryPlan, RunStep, RunSummary, RunUsage } from '../../src/types'
import { checkAnalysisBody, readJsonBody, type AnalysisInput } from '../shared/requestBody'
import {
  callModel,
  describeFailure,
  getApiKey,
  sumUsage,
  type ChatMessage,
  type ModelReply,
} from '../shared/provider'

const DEFAULT_ALLOWED_ORIGINS = [
  'https://jdgafx-app-05-ai-data-analyst.netlify.app',
  'http://localhost:8888',
  'http://localhost:5173',
]

// URL / DEPLOY_PRIME_URL are injected by Netlify, so branch and preview deploys
// keep working without editing this list.
const ALLOWED_ORIGINS = [
  ...(process.env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS.join(',')).split(','),
  process.env.URL ?? '',
  process.env.DEPLOY_PRIME_URL ?? '',
]
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean)

/** One budget for the whole request: the first call, its empty-reply retry and the repair turn. */
const UPSTREAM_TIMEOUT_MS = 25_000
/** A repair turn needs at least this much time left in the budget, or it is skipped. */
const REPAIR_MIN_MS = 8_000

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMITED = 'Rate limited, try again in a minute.'

// Best effort only: each warm function instance keeps its own counter, so the
// effective limit scales with instance count. Enough to blunt casual abuse of an
// unauthenticated demo endpoint; a shared store would be needed for a real quota.
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function rateLimit(key: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k)
    }
    return { allowed: true, retryAfter: 0 }
  }
  bucket.count += 1
  if (bucket.count > RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) }
  }
  return { allowed: true, retryAfter: 0 }
}

function clientKey(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

function corsHeaders(origin: string | null): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    base['Access-Control-Allow-Origin'] = origin
  }
  return base
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** Extracts the first complete JSON object, ignoring braces inside string literals. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

const SYSTEM_PROMPT = `You are a data analyst assistant. Given a dataset schema and sample data, generate a query plan to answer the user's question.

Return ONLY valid JSON with this exact structure (no markdown, no extra text):
{
  "chartType": "bar" | "line" | "pie" | "area" | "scatter",
  "groupBy": "<column name to group by>",
  "aggregate": {
    "field": "<column name to aggregate>",
    "fn": "sum" | "avg" | "count" | "min" | "max"
  },
  "filter": {
    "field": "<column name>",
    "op": "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains",
    "value": "<string value>"
  },
  "sortBy": {
    "field": "<the groupBy column or the aggregate field>",
    "dir": "asc" | "desc"
  },
  "title": "<descriptive chart title>",
  "explanation": "<brief explanation of what this visualization shows and why>",
  "missing": ["<each column, measure or category the question names that the dataset does not have>"] | null,
  "notice": "<one plain sentence, or null>"
}

Rules:
- "filter" and "sortBy" are optional — only include them if relevant
- If the question does not explicitly name a filter condition, omit "filter" entirely. Never invent a filter field or use a placeholder such as "missing".
- groupBy, aggregate.field and filter.field MUST be exact column names copied from the dataset. Never invent a column.
- sortBy.field must be either the groupBy column or the aggregate field — nothing else is plotted
- When the question asks for the lowest, least, smallest, coldest, fewest or bottom group, sort the aggregate field with dir "asc". When it asks for the highest, most, largest or top group, use dir "desc".
- For count queries, aggregate.field must still be a real column name (count ignores its value)
- Choose the most appropriate chartType for the data pattern
- "missing": list only what the question names that no column of the dataset provides, such as a measure the data does not hold. When you list something, "notice" is one sentence that says so and names the real column you used instead. Otherwise set "missing" to null.
- Never use "missing" or "notice" for formatting, data quality or parsing. Numeric cells may hold thousands separators, currency signs or percent signs, for example "1,200", and the browser parses them. Set "notice" to null unless "missing" is non-empty.`

/** Records each step, timed with Date.now() on the server, plus the usage of every model call. */
class RunLog {
  readonly startedAt = Date.now()
  readonly trace: RunStep[] = []
  readonly usage: RunUsage[] = []
  model: string | null = null

  step(
    name: string,
    status: RunStep['status'],
    startedAt: number,
    detail: string,
    extra: { tokens?: number; cost?: number } = {},
  ): void {
    this.trace.push({ name, status, ms: Date.now() - startedAt, detail, ...extra })
  }

  skip(names: string[], detail: string): void {
    for (const name of names) this.trace.push({ name, status: 'skipped', ms: 0, detail })
  }

  summary(): RunSummary {
    return {
      trace: this.trace,
      usage: sumUsage(this.usage),
      model: this.model,
      totalMs: Date.now() - this.startedAt,
    }
  }
}

const CUT_OFF_MESSAGE = 'The AI reply was cut off before the JSON finished. Try a narrower question.'
const EMPTY_MESSAGE = 'The AI returned an empty response. Try rephrasing your question.'
const UNREADABLE_MESSAGE = 'The AI response could not be read. Try rephrasing your question.'
const AFTER_MODEL_CALL = ['Read JSON reply', 'Check plan against columns', 'Repair turn']
const AFTER_READ = ['Check plan against columns', 'Repair turn']

type PlanRead = { ok: true; value: unknown; fields: number } | { ok: false; message: string }
type Checked = { ok: true; plan: QueryPlan } | { ok: false; message: string }
type Repaired = { ok: true; plan: QueryPlan } | { ok: false; status: number; message: string }

function readPlanJson(text: string): PlanRead {
  if (!text) return { ok: false, message: EMPTY_MESSAGE }
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const candidate = extractJsonObject(cleaned)
    if (!candidate) return { ok: false, message: UNREADABLE_MESSAGE }
    try {
      parsed = JSON.parse(candidate)
    } catch {
      return { ok: false, message: UNREADABLE_MESSAGE }
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: UNREADABLE_MESSAGE }
  }
  return { ok: true, value: parsed, fields: Object.keys(parsed).length }
}

function planSummary(plan: QueryPlan): string {
  return `${plan.chartType} chart: ${plan.aggregate.fn} of ${plan.aggregate.field} by ${plan.groupBy}.`
}

function callDetail(reply: ModelReply): string {
  const served = reply.model ? `Served by ${reply.model}.` : 'The reply did not name the model.'
  const retry = reply.attempts > 1 ? ' Retried once because the first reply was empty.' : ''
  return served + retry
}

function checkPlan(value: unknown, headers: string[], log: RunLog): Checked {
  const checkAt = Date.now()
  const validation = validateQueryPlan(value, headers)
  if (validation.ok) {
    log.step('Check plan against columns', 'ok', checkAt, planSummary(validation.plan))
    return { ok: true, plan: validation.plan }
  }
  log.step('Check plan against columns', 'failed', checkAt, validation.error)
  return { ok: false, message: validation.error }
}

/** One bounded repair turn: the model sees its rejected reply and the checker's reason, then answers once more. */
async function repairPlan(
  rejected: { reply: ModelReply; message: string },
  messages: ChatMessage[],
  headers: string[],
  log: RunLog,
  signal: AbortSignal,
): Promise<Repaired> {
  if (UPSTREAM_TIMEOUT_MS - (Date.now() - log.startedAt) < REPAIR_MIN_MS) {
    log.skip(['Repair turn'], 'Skipped: not enough time is left in this request for a second model call.')
    return { ok: false, status: 422, message: rejected.message }
  }

  const repairAt = Date.now()
  const askAgain: ChatMessage[] = [
    ...messages,
    { role: 'assistant', content: rejected.reply.text },
    {
      role: 'user',
      content: `Your previous reply was rejected: ${rejected.message} Reply again with the corrected JSON object only, using only column names from the dataset.`,
    },
  ]

  let reply: ModelReply
  try {
    reply = await callModel(askAgain, signal)
  } catch (err) {
    const failure = describeFailure(err)
    log.step('Repair turn', 'failed', repairAt, failure.message)
    return { ok: false, status: failure.status, message: failure.message }
  }
  log.model = reply.model ?? log.model
  log.usage.push(reply.usage)
  const costs = { tokens: reply.usage.total_tokens, cost: reply.usage.cost }

  const read = readPlanJson(reply.text)
  if (!read.ok) {
    const message = reply.finish === 'length' ? CUT_OFF_MESSAGE : read.message
    log.step('Repair turn', 'failed', repairAt, message, costs)
    return { ok: false, status: 502, message }
  }
  const check = validateQueryPlan(read.value, headers)
  if (!check.ok) {
    log.step('Repair turn', 'failed', repairAt, check.error, costs)
    return { ok: false, status: 422, message: check.error }
  }
  log.step('Repair turn', 'ok', repairAt, `The repaired plan passed the column check. ${planSummary(check.plan)}`, costs)
  return { ok: true, plan: check.plan }
}

function failed(log: RunLog, status: number, error: string, cors: Record<string, string>): Response {
  const headers = status === 429 ? { ...cors, 'Retry-After': '10' } : cors
  return json({ error, ...log.summary() }, status, headers)
}

async function analyse(
  input: AnalysisInput,
  log: RunLog,
  signal: AbortSignal,
  cors: Record<string, string>,
): Promise<Response> {
  const buildAt = Date.now()
  const schema = `Dataset with ${input.rowCount} rows.
Columns: ${input.headers.join(', ')}
Sample rows:
${JSON.stringify(input.sampleRows, null, 2)}`
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Dataset:\n${schema}\n\nQuestion: ${input.question}` },
  ]
  log.step(
    'Build request',
    'ok',
    buildAt,
    `Sending ${input.sampleRows.length} sample rows and ${input.headers.length} column names from a dataset of ${input.rowCount} rows.`,
  )

  const callAt = Date.now()
  let reply: ModelReply
  try {
    reply = await callModel(messages, signal)
  } catch (err) {
    const failure = describeFailure(err)
    log.step('Model call', 'failed', callAt, failure.message)
    log.skip(AFTER_MODEL_CALL, 'Not reached: the model call did not finish.')
    return failed(log, failure.status, failure.message, cors)
  }
  log.model = reply.model ?? log.model
  log.usage.push(reply.usage)
  log.step('Model call', 'ok', callAt, callDetail(reply), {
    tokens: reply.usage.total_tokens,
    cost: reply.usage.cost,
  })

  const readAt = Date.now()
  const read = readPlanJson(reply.text)
  if (!read.ok) {
    const message = reply.finish === 'length' ? CUT_OFF_MESSAGE : read.message
    log.step('Read JSON reply', 'failed', readAt, message)
    log.skip(AFTER_READ, 'Not reached: the reply was not a readable JSON object.')
    return failed(log, 502, message, cors)
  }
  log.step('Read JSON reply', 'ok', readAt, `Read a JSON object with ${read.fields} fields.`)

  const checked = checkPlan(read.value, input.headers, log)
  if (checked.ok) {
    log.skip(['Repair turn'], 'Not needed: the first plan passed the column check.')
    return json({ result: checked.plan, ...log.summary() }, 200, cors)
  }
  const outcome = await repairPlan({ reply, message: checked.message }, messages, input.headers, log, signal)
  if (!outcome.ok) return failed(log, outcome.status, outcome.message, cors)
  return json({ result: outcome.plan, ...log.summary() }, 200, cors)
}

async function handle(req: Request, origin: string | null, cors: Record<string, string>): Promise<Response> {
  const originAllowed = !origin || ALLOWED_ORIGINS.includes(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: originAllowed ? 204 : 403, headers: cors })
  }
  if (!originAllowed) return json({ error: 'Origin not allowed.' }, 403, cors)
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors)

  const limit = rateLimit(clientKey(req))
  if (!limit.allowed) {
    return json({ error: RATE_LIMITED }, 429, { ...cors, 'Retry-After': String(limit.retryAfter) })
  }
  if (!getApiKey()) return json({ error: 'The analysis service is not configured.' }, 500, cors)

  const raw = await readJsonBody(req)
  if (!raw.ok) return json({ error: raw.error }, raw.status, cors)
  const checked = checkAnalysisBody(raw.value)
  if (!checked.ok) return json({ error: checked.error }, checked.status, cors)

  const log = new RunLog()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    return await analyse(checked.value, log, controller.signal, cors)
  } finally {
    clearTimeout(timer)
  }
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin)
  try {
    return await handle(req, origin, cors)
  } catch {
    return json({ error: 'The analysis failed unexpectedly. Please try again.' }, 500, cors)
  }
}

export const config = { path: '/api/ai' }
