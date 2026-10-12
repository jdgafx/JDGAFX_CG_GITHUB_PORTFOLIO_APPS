import { stripBadCitations, withSources } from '../../src/lib/sources'
import { sumUsage } from '../../src/lib/usage'
import type { ModelFacts, StageUsage, StreamEvent, TraceStep } from '../../src/types'
import { AGENTS, MIN_STAGE_MS, RUN_BUDGET_MS, keyLine, type AgentConfig, type AgentContext } from '../shared/agents'
import { RequestError, clientKey, corsHeaders, fail, isOriginAllowed, rateLimit, readQuery, sseEvent } from '../shared/gate'
import { newestModel, modelFacts } from '../shared/newest-model'
import { getProvider, type Provider } from '../shared/provider'
import { RETRIEVE_TIMEOUT_MS, retrieveSources } from '../shared/retrieve'
import {
  RunCancelledError,
  cutOffMessage,
  friendlyUpstreamMessage,
  isConnectionError,
  runStage,
  UpstreamError,
  type StageResult,
} from '../shared/stream'

const NO_DATA_MESSAGE = 'Live data unavailable, so no report was written.'

/** `cutOff` marks a reply that stopped before its end: the run stops there, and the cut text is not kept. */
type Outcome = { ok: true; stage: StageResult } | { ok: false; message: string; usage?: StageUsage; cutOff?: true }

/** What the server keeps about each stage, to build the trace and the totals. */
interface StageRecord {
  name: string
  status: TraceStep['status']
  ms: number
  detail: string
  usage?: StageUsage
}

function failureMessage(err: unknown, name: string): string {
  if (err instanceof UpstreamError) return friendlyUpstreamMessage(err.status)
  // The request never got an answer. The message names the stage that failed and says what happened, as the key case does.
  if (isConnectionError(err)) return `${name} could not reach the AI provider. Try again.`
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
  runSignal: AbortSignal,
): Promise<Outcome> {
  try {
    const stage = await runStage(agent, agent.buildUserMessage(query, context), provider, deadline, runSignal)
    // Checked before the text: a reply that ran out of length can still read like a complete answer.
    const cut = cutOffMessage(stage.finish, agent.name, ', so the run was stopped')
    // A timeout fails the stage like any stage without an answer; a reply that stopped on its own ends the run.
    if (cut) return { ok: false, message: cut, usage: stage.usage, ...(stage.finish === 'timeout' ? {} : { cutOff: true as const }) }
    if (stage.content.trim()) return { ok: true, stage }
    return { ok: false, message: `${agent.name} returned no text. Try again.`, usage: stage.usage }
  } catch (err) {
    if (err instanceof RunCancelledError) throw err
    return { ok: false, message: failureMessage(err, agent.name) }
  }
}

/**
 * Retrieves public sources, then runs the four model stages in order, all against one shared
 * deadline, and reports each step as it ends. Retrieval draws on the same run budget, so a slow
 * lookup shortens the stages instead of adding to the run. When the visitor leaves, no later step
 * starts and the call in flight is aborted.
 */
async function runPipeline(
  query: string,
  provider: Provider,
  send: (event: StreamEvent) => void,
  runSignal: AbortSignal,
): Promise<void> {
  const runStart = Date.now()
  const deadline = runStart + RUN_BUDGET_MS
  const context: AgentContext = {}
  const records: StageRecord[] = []
  /** The model of the Synthesizer, whose reply is the report the visitor is shown. */
  let shownModel: ModelFacts | undefined

  send({ type: 'retrieve_start' })
  const found = await retrieveSources(query, {
    signal: runSignal,
    timeoutMs: Math.min(RETRIEVE_TIMEOUT_MS, deadline - Date.now()),
  })
  if (runSignal.aborted) return
  const retrieveMs = Date.now() - runStart
  context.sources = found.sources
  const retrieveRecord: StageRecord = {
    name: 'Retrieve',
    status: found.reached ? 'ok' : 'failed',
    ms: retrieveMs,
    detail: found.detail,
  }
  // No sources means no live data. A report from model memory would be substitute data, so the run ends here, before any model call.
  if (found.sources.length === 0) {
    send({ type: 'agent_error', agent: 'retriever', ms: retrieveMs, error: `${NO_DATA_MESSAGE} ${found.detail}` })
    for (const agent of AGENTS) send({ type: 'agent_skipped', agent: agent.role, detail: 'Not started: no live data was retrieved.' })
    return
  }
  send({ type: 'retrieve_complete', ms: retrieveMs, sources: found.sources, detail: found.detail })

  // One list fetch per run, started before the first model call. It is awaited after each reply and never adds more than its own timeout.
  const newestP = newestModel()
  for (const agent of AGENTS) {
    if (runSignal.aborted) return
    const started = Date.now()
    if (deadline - started < MIN_STAGE_MS) {
      const detail = 'Not started: the run ran out of time.'
      records.push({ name: agent.name, status: 'skipped', ms: 0, detail })
      send({ type: 'agent_skipped', agent: agent.role, detail })
      context[agent.role] = ''
      continue
    }

    send({ type: 'agent_start', agent: agent.role, maxTokens: agent.maxTokens })
    const outcome = await runOneStage(agent, query, context, provider, deadline, runSignal)
    const ms = Date.now() - started

    if (outcome.ok) {
      const { stage } = outcome
      // A marker that points at no retrieved source never reaches the page, whatever the model wrote.
      const cleaned = stripBadCitations(stage.content, found.sources.length)
      const detail = keyLine(cleaned)
      // The Sources list is built from what was retrieved, never from model text.
      const content = agent.role === 'synthesizer' ? withSources(cleaned, found.sources) : cleaned
      context[agent.role] = content
      const newest = await newestP
      const model = modelFacts(stage.servedModel, newest)
      // One record per attempt. The attempt that gave the reply shares its record, so it is judged and logged once.
      const calls = (stage.attemptServed ?? [stage.servedModel]).map(served => (served === stage.servedModel ? model : modelFacts(served, newest)))
      if (agent.role === 'synthesizer') shownModel = model
      records.push({ name: agent.name, status: 'ok', ms, detail, usage: stage.usage })
      send({ type: 'agent_chunk', agent: agent.role, content })
      send({
        type: 'agent_complete',
        agent: agent.role,
        ms,
        detail,
        finish: stage.finish,
        reasoningTokens: stage.reasoningTokens,
        model,
        calls,
        usage: stage.usage,
        ...(stage.retried ? { retried: stage.retried } : {}),
      })
    } else {
      context[agent.role] = ''
      records.push({ name: agent.name, status: 'failed', ms, detail: outcome.message, usage: outcome.usage })
      send({ type: 'agent_error', agent: agent.role, ms, error: outcome.message, ...(outcome.usage ? { usage: outcome.usage } : {}) })
      if (outcome.cutOff) {
        // A cut-off reply ends the run: no later stage reads it, and no report is written from it.
        const detail = `Not started: ${agent.name} was cut off.`
        for (const later of AGENTS.slice(AGENTS.indexOf(agent) + 1)) {
          records.push({ name: later.name, status: 'skipped', ms: 0, detail })
          send({ type: 'agent_skipped', agent: later.role, detail })
        }
        break
      }
    }
  }

  if (runSignal.aborted) return
  // Skipped stages and the retrieval were never model calls, so they are left out of the totals.
  const called = records.filter(record => record.status !== 'skipped')
  send({
    type: 'session_complete',
    agent: 'synthesizer',
    result: context.synthesizer ?? '',
    trace: [retrieveRecord, ...records].map(toTraceStep),
    usage: sumUsage(called.map(record => record.usage)),
    model: shownModel,
    totalMs: Date.now() - runStart,
  })
}

/** The whole request path. Anything it does not expect is caught by the wrapper below. */
async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get('origin')
  const allowed = isOriginAllowed(req, origin)
  const headersOut = corsHeaders(req, origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: allowed ? 204 : 403, headers: headersOut })
  }
  if (!allowed) return fail('Origin not allowed.', 403, headersOut)
  if (req.method !== 'POST') return fail('Method not allowed.', 405, headersOut)

  const limit = rateLimit(clientKey(req))
  if (!limit.allowed) {
    return fail('Rate limited, try again in a minute.', 429, {
      ...headersOut,
      'Retry-After': String(limit.retryAfter),
    })
  }

  let query: string
  try {
    query = await readQuery(req)
  } catch (err) {
    if (err instanceof RequestError) return fail(err.message, err.status, headersOut)
    throw err
  }

  const provider = getProvider()
  if (!provider) return fail('The AI service is not configured on the server.', 500, headersOut)

  const encoder = new TextEncoder()
  // The run stops when the visitor leaves: the request is aborted, or the response stream is cancelled.
  const runAbort = new AbortController()
  const onLeave = () => runAbort.abort()
  if (req.signal.aborted) runAbort.abort()
  req.signal.addEventListener('abort', onLeave, { once: true })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // A visitor who has left closes the controller. The run still finishes its bookkeeping.
      const write = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          /* the visitor has gone */
        }
      }
      const send = (event: StreamEvent) => write(sseEvent(event))

      try {
        await runPipeline(query, provider, send, runAbort.signal)
      } catch (err) {
        // A cancelled run stops quietly. Anything else is reported once.
        if (!(err instanceof RunCancelledError)) {
          send({ type: 'agent_error', agent: 'system', error: 'The run stopped unexpectedly. Try again.' })
        }
      } finally {
        req.signal.removeEventListener('abort', onLeave)
        write('data: [DONE]\n\n')
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      runAbort.abort()
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

/** Every request gets a response. Unexpected failures become a generic 500 JSON body. */
export default async (req: Request): Promise<Response> => {
  try {
    return await handle(req)
  } catch {
    return fail('Something went wrong on the server. Try again.', 500, corsHeaders(req, req.headers.get('origin')))
  }
}
