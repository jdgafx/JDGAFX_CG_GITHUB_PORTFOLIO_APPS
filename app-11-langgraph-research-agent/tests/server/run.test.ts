import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { RUN_BUDGET_MS } from '../../netlify/functions/run'
import type { Frame, NodeEndFrame } from '../../netlify/shared/events'
import { NODE_MODEL } from '../../netlify/shared/models'
import { roleOf } from '../helpers/roles'

// Smoke tests for netlify/functions/run.ts. Both upstreams are stubbed: every fetch is
// replaced before the handler runs, and the key is a placeholder for the test only.

type Handler = (req: Request) => Promise<Response>

interface SentBody {
  model: string
  max_tokens: number
  usage: { include: boolean }
  reasoning?: { enabled: boolean }
  response_format?: { type: string }
  tools?: unknown[]
  messages: Array<{ role: string; content: string }>
}

const PLACEHOLDER_KEY = 'test-only-placeholder'
const ORIGIN = 'http://localhost:5173'
const LIVE_ENDPOINT = 'https://jdgafx-app-11-langgraph-research-agent.netlify.app/api/run'
const SAMPLE = 'In what year did Lisbon host a World Exposition, and what was its theme?'
const ANSWER = 'Lisbon hosted Expo \'98 in 1998 [1]. Its theme was "The Oceans: A Heritage for the Future" [1].'
const PROVIDER_REJECTED = 'The AI provider rejected the key or is out of credit.'
const PROVIDER_SLOW = 'The AI provider did not answer in time.'
const BUDGET_MESSAGE = 'The run reached its time limit before this step finished.'

const pageFixture: unknown = JSON.parse(
  readFileSync(new URL('../fixtures/wikipedia-page.json', import.meta.url), 'utf8'),
) as unknown

const originalKey = process.env.OPENROUTER_API_KEY
let handler: Handler
let ipCounter = 0

beforeAll(async () => {
  handler = (await import('../../netlify/functions/run')).default
})

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = PLACEHOLDER_KEY
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalKey
  vi.unstubAllGlobals()
})

function post(body: unknown, origin: string | null = ORIGIN): Request {
  ipCounter += 1
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-nf-client-connection-ip': `203.0.113.${ipCounter}`,
  }
  if (origin) headers.Origin = origin
  return new Request(LIVE_ENDPOINT, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function modelReply(content: string | null, toolCalls?: unknown[]): Response {
  return Response.json({
    model: 'anthropic/claude-haiku-5.5',
    choices: [
      {
        message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180, cost: 0.0001 },
  })
}

/** The sample run: one plan, one page read, a cited draft the critic accepts. */
function sampleOpenRouter(): (body: SentBody) => Response {
  let agentTurn = 0
  return (body) => {
    const role = roleOf(body)
    if (role === 'plan') return modelReply('{"queries": ["Expo 98 Lisbon"]}')
    if (role === 'critic') return modelReply('{"verdict": "accept", "issues": []}')
    if (body.tools) {
      agentTurn += 1
      if (agentTurn === 1) {
        const tool = {
          id: 'call_1',
          type: 'function',
          function: { name: 'wikipedia_page', arguments: JSON.stringify({ title: "Expo '98" }) },
        }
        return modelReply(null, [tool])
      }
      return modelReply('Enough sources.')
    }
    return modelReply(ANSWER)
  }
}

function stubUpstreams(
  openrouter: (body: SentBody) => Response | Promise<Response>,
  wikipedia: () => Response | Promise<Response> = () => Response.json(pageFixture),
) {
  const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://openrouter.ai/')) return openrouter(JSON.parse(String(init?.body)) as SentBody)
    if (url.startsWith('https://en.wikipedia.org/')) return wikipedia()
    throw new Error(`Unexpected upstream call to ${url}`)
  })
  vi.stubGlobal('fetch', fetchStub)
  return fetchStub
}

async function readStream(response: Response): Promise<{ frames: Frame[]; lastRecord: string }> {
  const text = await response.text()
  // A record that starts with a colon is a heartbeat comment, not a frame.
  const records = text.split('\n\n').filter((record) => record !== '' && !record.startsWith(':'))
  const frames = records
    .filter((record) => record !== 'data: [DONE]')
    .map((record) => JSON.parse(record.slice('data: '.length)) as Frame)
  return { frames, lastRecord: records.at(-1) ?? '' }
}

describe('POST /api/run', () => {
  it('streams the sample run: every node in order, a cited result, then [DONE]', async () => {
    const fetchStub = stubUpstreams(sampleOpenRouter())

    const response = await handler(post({ question: SAMPLE }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8')

    const { frames, lastRecord } = await readStream(response)
    expect(lastRecord).toBe('data: [DONE]')

    const starts = frames.flatMap((frame) => (frame.type === 'node_start' ? [frame.node] : []))
    expect(starts).toEqual(['plan', 'agent', 'tools', 'agent', 'draft', 'critic', 'final'])

    const ends = frames.filter((frame): frame is NodeEndFrame => frame.type === 'node_end')
    expect(ends.map((end) => end.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'])
    expect(ends[0]).toMatchObject({ node: 'plan', model: NODE_MODEL, servedModel: 'anthropic/claude-haiku-5.5', cost: 0.0001 })

    expect(frames.flatMap((frame) => (frame.type === 'edge' ? [frame.label] : []))).toEqual([
      'tools (round 1 of 4)',
      'draft (no more searches)',
      'final (accepted)',
    ])

    expect(frames.find((frame) => frame.type === 'result')).toMatchObject({
      type: 'result',
      answer: ANSWER,
      sources: [{ n: 1, title: "Expo '98", url: "https://en.wikipedia.org/wiki/Expo_'98" }],
      evidenceCount: 1,
      toolRounds: 1,
      revisions: 0,
      path: starts,
      critic: { verdict: 'accept', reviewed: true },
      truncated: false,
      // Every model call in the sample run reports a cost, so no row is left unpriced.
      totals: { unpricedRows: 0 },
    })

    // Five model calls and one page read. The first model call is the plan, sent with the agreed limits.
    expect(fetchStub).toHaveBeenCalledTimes(6)
    const [planUrl, planInit] = fetchStub.mock.calls[0] ?? []
    expect(planUrl).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(planInit?.headers).toMatchObject({ Authorization: `Bearer ${PLACEHOLDER_KEY}` })
    expect(JSON.parse(String(planInit?.body)) as SentBody).toMatchObject({
      model: NODE_MODEL,
      max_tokens: 400,
      usage: { include: true },
      response_format: { type: 'json_object' },
    })

    // Every model request carries reasoning: off, so the output cap goes to the reply.
    const modelBodies = fetchStub.mock.calls
      .filter(([url]) => String(url).startsWith('https://openrouter.ai/'))
      .map(([, init]) => JSON.parse(String(init?.body)) as SentBody)
    expect(modelBodies).toHaveLength(5)
    for (const body of modelBodies) expect(body.reasoning).toEqual({ enabled: false })

    // Every node uses Haiku 5.5, which rejects a temperature, so no request body carries one.
    for (const body of modelBodies) {
      expect(body.model).toBe('anthropic/claude-haiku-5.5')
      expect('temperature' in body).toBe(false)
    }
  })

  it('answers a GET with 405 and makes no upstream call', async () => {
    const fetchStub = stubUpstreams(sampleOpenRouter())
    const response = await handler(new Request(LIVE_ENDPOINT, { method: 'GET', headers: { Origin: ORIGIN } }))
    expect(response.status).toBe(405)
    expect(await response.json()).toEqual({ success: false, error: 'Method not allowed.' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('answers an empty question with 400 and the handler message, with no upstream call', async () => {
    const fetchStub = stubUpstreams(sampleOpenRouter())
    const response = await handler(post({ question: '   ' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'The question must be 1 to 500 characters.',
    })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('answers a question over 500 characters with 400', async () => {
    const fetchStub = stubUpstreams(sampleOpenRouter())
    const response = await handler(post({ question: 'x'.repeat(501) }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, error: 'The question must be 1 to 500 characters.' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('answers a body that is not JSON with 400', async () => {
    const fetchStub = stubUpstreams(sampleOpenRouter())
    const response = await handler(post('{"question":'))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, error: 'The request body must be JSON.' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('answers 503 before any call when no key is configured', async () => {
    delete process.env.OPENROUTER_API_KEY
    const fetchStub = stubUpstreams(sampleOpenRouter())
    const response = await handler(post({ question: SAMPLE }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ success: false, error: 'The AI provider is not configured.' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('maps a provider 402 to a plain error frame after the failed node, and never shows the provider body', async () => {
    const fetchStub = stubUpstreams(() => Response.json({ error: 'billing detail 42' }, { status: 402 }))
    const response = await handler(post({ question: SAMPLE }))
    expect(response.status).toBe(200)

    const { frames, lastRecord } = await readStream(response)
    expect(lastRecord).toBe('data: [DONE]')
    expect(frames).toEqual([
      { type: 'run_start', runId: expect.stringMatching(/^[0-9a-f]{8}$/) },
      { type: 'node_start', node: 'plan', visit: 1, ms: expect.any(Number) },
      {
        type: 'node_end',
        node: 'plan',
        visit: 1,
        ms: expect.any(Number),
        status: 'failed',
        detail: PROVIDER_REJECTED,
      },
      { type: 'error', message: PROVIDER_REJECTED },
    ])
    expect(JSON.stringify(frames)).not.toContain('billing detail')
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('maps a provider 500 to the slow-provider message in an error frame', async () => {
    stubUpstreams(() => Response.json({ error: 'internal' }, { status: 500 }))
    const { frames, lastRecord } = await readStream(await handler(post({ question: SAMPLE })))
    expect(lastRecord).toBe('data: [DONE]')
    expect(frames.at(-1)).toEqual({ type: 'error', message: PROVIDER_SLOW })
  })

  it('keeps the pages read when a provider 500 fails the draft, says no answer was written, and still ends with [DONE]', async () => {
    const answerTurn = sampleOpenRouter()
    const fetchStub = stubUpstreams((body) =>
      roleOf(body) !== 'draft'
        ? answerTurn(body)
        : Response.json({ error: 'internal provider detail' }, { status: 500 }),
    )

    const { frames, lastRecord } = await readStream(await handler(post({ question: SAMPLE })))

    expect(lastRecord).toBe('data: [DONE]')
    const draftEnd = frames.find(
      (frame): frame is NodeEndFrame => frame.type === 'node_end' && frame.node === 'draft',
    )
    expect(draftEnd).toMatchObject({ status: 'failed', detail: PROVIDER_SLOW })
    expect(frames.at(-1)).toMatchObject({
      type: 'result',
      answer: '',
      sources: [{ n: 1, title: "Expo '98", url: "https://en.wikipedia.org/wiki/Expo_'98" }],
      ending: { kind: 'no_answer' },
    })
    expect(frames.some((frame) => frame.type === 'error')).toBe(false)
    expect(frames.some((frame) => frame.type === 'node_start' && frame.node === 'critic')).toBe(false)
    expect(JSON.stringify(frames)).not.toContain('internal provider detail')
    expect(JSON.stringify(frames)).not.toContain('AggregateError')
    // Plan, agent, page read, agent, then the failing draft.
    expect(fetchStub).toHaveBeenCalledTimes(5)
  })

  it('maps a timed-out provider call to the slow-provider message', async () => {
    stubUpstreams(() => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })
    const { frames, lastRecord } = await readStream(await handler(post({ question: SAMPLE })))
    expect(lastRecord).toBe('data: [DONE]')
    expect(frames.at(-1)).toEqual({ type: 'error', message: PROVIDER_SLOW })
  })

  it('ends a run that outlasts the run budget with the pages read, the budget message and [DONE], before the platform cut-off', async () => {
    vi.useFakeTimers()
    try {
      // Every provider call takes 9 s, inside the per-call limit, so only the budget for the whole run can stop the chain.
      const answers = sampleOpenRouter()
      const fetchStub = vi.fn(
        (input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            if (String(input).startsWith('https://en.wikipedia.org/')) {
              resolve(Response.json(pageFixture))
              return
            }
            const timer = setTimeout(() => resolve(answers(JSON.parse(String(init?.body)) as SentBody)), 9_000)
            init?.signal?.addEventListener('abort', () => {
              clearTimeout(timer)
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            })
          }),
      )
      vi.stubGlobal('fetch', fetchStub)

      const reading = readStream(await handler(post({ question: SAMPLE })))
      await vi.advanceTimersByTimeAsync(RUN_BUDGET_MS + 1_000)
      const { frames, lastRecord } = await reading

      expect(RUN_BUDGET_MS).toBeLessThan(30_000)
      expect(lastRecord).toBe('data: [DONE]')
      // Plan and agent took 18 s, so the agent turn was skipped for time and the 9 s draft hit the budget.
      expect(frames.at(-1)).toMatchObject({ type: 'result', answer: '', ending: { kind: 'no_answer' } })
      const stopped = frames.find((frame): frame is NodeEndFrame => frame.type === 'node_end' && frame.status === 'failed')
      expect(stopped).toMatchObject({ node: 'draft', detail: BUDGET_MESSAGE })
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps an unreachable provider to a plain message in an error frame', async () => {
    stubUpstreams(() => {
      throw new TypeError('fetch failed')
    })
    const { frames } = await readStream(await handler(post({ question: SAMPLE })))
    expect(frames.at(-1)).toEqual({ type: 'error', message: 'Could not reach the AI provider.' })
  })

  it('refuses an origin that is not on the allowlist with 403, with no upstream call', async () => {
    const fetchStub = stubUpstreams(sampleOpenRouter())
    const response = await handler(post({ question: SAMPLE }, 'https://evil.example'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ success: false, error: 'Origin not allowed.' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('answers the preflight request with 204 and the allowed origin', async () => {
    const response = await handler(new Request(LIVE_ENDPOINT, { method: 'OPTIONS', headers: { Origin: ORIGIN } }))
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })
})
