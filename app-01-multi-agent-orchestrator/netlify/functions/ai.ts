import { sumUsage } from '../../src/lib/usage'
import type { StageUsage, StreamEvent, TraceStep } from '../../src/types'
import { AGENTS, MIN_STAGE_MS, RUN_BUDGET_MS, keyLine, type AgentConfig, type AgentContext } from '../shared/agents'
import { RequestError, clientKey, corsHeaders, fail, isOriginAllowed, rateLimit, readQuery, sseEvent } from '../shared/gate'
import { getProvider, type Provider } from '../shared/provider'
import { friendlyUpstreamMessage, runStage, UpstreamError, type StageResult } from '../shared/stream'

type Outcome = { ok: true; stage: StageResult } | { ok: false; message: string; usage?: StageUsage }

/** What the server keeps about each stage, to build the trace and the totals. */
interface StageRecord {
  name: string
  status: TraceStep['status']
  ms: number
  detail: string
  usage?: StageUsage
  servedModel?: string
}

function failureMessage(err: unknown, name: string): string {
  if (err instanceof UpstreamError) return friendlyUpstreamMessage(err.status)
  return `${name} could not finish. Try again.`
}

function toTraceStep(record: StageRecord): TraceStep {
  return {
    name: record.name,
    status: record.status,
    ms: record.ms,
    detail: record.detail,
    tokens: record.usage?.completion_tokens,
    cost: record.usage?.cost,
  }
}

async function runOneStage(
  agent: AgentConfig,
  query: string,
  context: AgentContext,
  provider: Provider,
  deadline: number,
): Promise<Outcome> {
  try {
    const stage = await runStage(agent, agent.buildUserMessage(query, context), provider, deadline)
    if (stage.content.trim()) return { ok: true, stage }
    const message =
      stage.finish === 'timeout'
        ? `${agent.name} ran out of time before it wrote anything.`
        : `${agent.name} returned no text. Try again.`
    return { ok: false, message, usage: stage.usage }
  } catch (err) {
    return { ok: false, message: failureMessage(err, agent.name) }
  }
}

/** Runs the four stages in order against one shared deadline and reports each step as it ends. */
async function runPipeline(query: string, provider: Provider, send: (event: StreamEvent) => void): Promise<void> {
  const runStart = Date.now()
  const deadline = runStart + RUN_BUDGET_MS
  const context: AgentContext = {}
  const records: StageRecord[] = []

  for (const agent of AGENTS) {
    const started = Date.now()
    if (deadline - started < MIN_STAGE_MS) {
      const detail = 'Not started: the run ran out of time.'
      records.push({ name: agent.name, status: 'skipped', ms: 0, detail })
      send({ type: 'agent_skipped', agent: agent.role, detail })
      context[agent.role] = ''
      continue
    }

    send({ type: 'agent_start', agent: agent.role, maxTokens: agent.maxTokens })
    const outcome = await runOneStage(agent, query, context, provider, deadline)
    const ms = Date.now() - started

    if (outcome.ok) {
      const { stage } = outcome
      const detail = keyLine(stage.content)
      context[agent.role] = stage.content
      records.push({ name: agent.name, status: 'ok', ms, detail, usage: stage.usage, servedModel: stage.servedModel })
      send({ type: 'agent_chunk', agent: agent.role, content: stage.content })
      send({
        type: 'agent_complete',
        agent: agent.role,
        ms,
        detail,
        finish: stage.finish,
        reasoningTokens: stage.reasoningTokens,
        servedModel: stage.servedModel,
        usage: stage.usage,
      })
    } else {
      context[agent.role] = ''
      records.push({ name: agent.name, status: 'failed', ms, detail: outcome.message, usage: outcome.usage })
      send({ type: 'agent_error', agent: agent.role, ms, error: outcome.message })
    }
  }

  // Skipped stages were never called, so they are left out of the totals.
  const called = records.filter(record => record.status !== 'skipped')
  send({
    type: 'session_complete',
    agent: 'synthesizer',
    result: context.synthesizer ?? '',
    trace: records.map(toTraceStep),
    usage: sumUsage(called.map(record => record.usage)),
    model: called.map(record => record.servedModel).find(Boolean),
    totalMs: Date.now() - runStart,
  })
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  const allowed = isOriginAllowed(req, origin)
  const headersOut = corsHeaders(req, origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: allowed ? 204 : 403, headers: headersOut })
  }
  if (!allowed) return fail('Origin not allowed.', 403, headersOut)
  if (req.method !== 'POST') return fail('Method not allowed', 405, headersOut)

  const limit = rateLimit(clientKey(req))
  if (!limit.allowed) {
    return fail('Too many requests. Wait a minute and try again.', 429, {
      ...headersOut,
      'Retry-After': String(limit.retryAfter),
    })
  }

  let query: string
  try {
    query = await readQuery(req)
  } catch (err) {
    const status = err instanceof RequestError ? err.status : 400
    return fail(err instanceof RequestError ? err.message : 'Invalid request.', status, headersOut)
  }

  const provider = getProvider()
  if (!provider) return fail('The AI service is not configured on the server.', 500, headersOut)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encoder.encode(sseEvent(event)))

      try {
        await runPipeline(query, provider, send)
      } catch {
        send({ type: 'agent_error', agent: 'system', error: 'The run stopped unexpectedly. Try again.' })
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...headersOut,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
