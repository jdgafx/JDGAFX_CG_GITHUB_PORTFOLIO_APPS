import { afterEach, describe, expect, it, vi } from 'vitest'
import { STAGE_IDS, runPipeline, type CallRecord, type StageId, type StageOutputs } from '../../src/lib/api'

const LABEL = 'The AI provider answered with a safety label instead of text, so this stage was discarded.'
const EMPTY = 'The AI provider returned no text for this stage.'
const CUT_OFF = 'This stage ran out of room before it finished.'
const KEY = 'The AI provider rejected the key or is out of credit.'
const SLOW = 'The AI provider did not answer in time.'
const NETWORK = 'Could not reach the server. Check your connection and try again.'
const USAGE = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 }
const MODEL = 'anthropic/claude-haiku-4.5'

afterEach(() => {
  vi.unstubAllGlobals()
})

interface Sent {
  url: string
  body: Record<string, unknown>
  signal: AbortSignal | undefined
}

type Reply = (sent: Sent) => Response | Promise<Response>

// Answers each browser request with the next queued reply, and records every request sent.
function serve(replies: Reply[]): Sent[] {
  const queue = [...replies]
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const record: Sent = {
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      signal: init?.signal ?? undefined,
    }
    sent.push(record)
    const next = queue.shift()
    if (!next) throw new Error('No reply is queued for this request')
    return next(record)
  }))
  return sent
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stageOk(result: string): Response {
  return json(200, {
    result,
    trace: [{ name: 'Stage', status: 'ok', ms: 1200, detail: 'detail' }],
    usage: USAGE,
    model: MODEL,
    totalMs: 1200,
  })
}

function stageFailed(status: number, message: string, retryable: boolean, extra: Record<string, unknown> = {}): Response {
  return json(status, {
    error: message,
    retryable,
    trace: [{ name: 'Stage', status: 'failed', ms: 800, detail: message }],
    totalMs: 800,
    ...extra,
  })
}

function harness() {
  const starts: StageId[] = []
  const calls: CallRecord[] = []
  const finished: StageId[] = []
  const callbacks = {
    onStageStart: (stage: StageId) => {
      starts.push(stage)
    },
    onCall: (record: CallRecord) => {
      calls.push(record)
    },
    onStageDone: (stage: StageId) => {
      finished.push(stage)
    },
  }
  return { starts, calls, finished, callbacks }
}

function request(context: StageOutputs = {}, signal: AbortSignal = new AbortController().signal) {
  return { topic: 'Why unit tests matter for small teams', contentType: 'Blog Post' as const, context, signal }
}

describe('runPipeline sequencing', () => {
  it('runs the five stages in order, one call each, and records usage and model', async () => {
    const sent = serve(STAGE_IDS.map(id => () => stageOk(`${id} text`)))
    const h = harness()

    expect(await runPipeline(request(), h.callbacks)).toEqual({ kind: 'complete' })
    expect(h.starts).toEqual(['research', 'outline', 'draft', 'edit', 'polish'])
    expect(h.finished).toEqual(['research', 'outline', 'draft', 'edit', 'polish'])
    expect(h.calls.map(call => call.row.name)).toEqual(['Research', 'Outline', 'Draft', 'Edit', 'Polish'])
    expect(h.calls[0].usage).toEqual(USAGE)
    expect(h.calls[0].model).toBe(MODEL)
    expect(sent.map(call => call.body.stage)).toEqual(['research', 'outline', 'draft', 'edit', 'polish'])
    expect(sent[1].body.context).toEqual({ research: 'research text' })
    expect(sent[4].body.context).toEqual({
      research: 'research text', outline: 'outline text', draft: 'draft text', edit: 'edit text',
    })
  })

  it('sends only the topic, the format, the stage and the outputs, never a model name', async () => {
    const sent = serve([() => stageOk('r')])
    await runPipeline(request(), harness().callbacks)
    expect(Object.keys(sent[0].body)).toEqual(['topic', 'contentType', 'stage', 'context'])
    expect(sent[0].url).toBe('/api/ai')
  })

  it('resumes after the finished stages without calling them again', async () => {
    const sent = serve([() => stageOk('d'), () => stageOk('e'), () => stageOk('p')])
    const h = harness()

    expect(await runPipeline(request({ research: 'research text', outline: 'outline text' }), h.callbacks)).toEqual({
      kind: 'complete',
    })
    expect(h.starts).toEqual(['draft', 'edit', 'polish'])
    expect(sent).toHaveLength(3)
    expect(sent[0].body.context).toEqual({ research: 'research text', outline: 'outline text' })
  })
})

describe('runPipeline retries and failures', () => {
  it('retries an empty stage once and labels the retry', async () => {
    const sent = serve([
      () => stageFailed(502, EMPTY, true),
      () => stageOk('research text'),
      () => stageOk('o'),
      () => stageOk('d'),
      () => stageOk('e'),
      () => stageOk('p'),
    ])
    const h = harness()

    expect(await runPipeline(request(), h.callbacks)).toEqual({ kind: 'complete' })
    expect(sent).toHaveLength(6)
    expect(h.calls.slice(0, 2).map(call => [call.row.name, call.row.status])).toEqual([
      ['Research', 'failed'],
      ['Research (retry)', 'ok'],
    ])
  })

  it('retries a cut-off stage only once, then stops the run at that stage', async () => {
    const sent = serve([() => stageFailed(502, CUT_OFF, true), () => stageFailed(502, CUT_OFF, true)])
    const h = harness()

    expect(await runPipeline(request(), h.callbacks)).toEqual({ kind: 'failed', stage: 'research', message: CUT_OFF })
    expect(sent).toHaveLength(2)
    expect(h.calls.map(call => call.row.name)).toEqual(['Research', 'Research (retry)'])
  })

  it('does not retry a moderation label, and keeps its plain message', async () => {
    const sent = serve([() => stageFailed(502, LABEL, false)])
    expect(await runPipeline(request(), harness().callbacks)).toEqual({ kind: 'failed', stage: 'research', message: LABEL })
    expect(sent).toHaveLength(1)
  })

  it('does not retry a rejected key or missing credit', async () => {
    const sent = serve([() => stageFailed(502, KEY, false)])
    const h = harness()
    expect(await runPipeline(request(), h.callbacks)).toEqual({ kind: 'failed', stage: 'research', message: KEY })
    expect(sent).toHaveLength(1)
    expect(h.calls[0].usage).toBeNull()
  })

  it('does not retry a timeout', async () => {
    const sent = serve([() => stageFailed(504, SLOW, false)])
    expect(await runPipeline(request(), harness().callbacks)).toEqual({ kind: 'failed', stage: 'research', message: SLOW })
    expect(sent).toHaveLength(1)
  })

  it('does not retry a network failure, and says so in plain words', async () => {
    const sent = serve([() => { throw new TypeError('Failed to fetch') }])
    expect(await runPipeline(request(), harness().callbacks)).toEqual({ kind: 'failed', stage: 'research', message: NETWORK })
    expect(sent).toHaveLength(1)
  })

  it.each<[number, string]>([
    [429, 'Rate limited, try again in a minute.'],
    [503, SLOW],
    [400, 'The request could not be completed. Please retry.'],
  ])('shows a plain message for HTTP %i with no JSON body', async (status, message) => {
    const sent = serve([() => new Response('<html>gateway</html>', { status })])
    expect(await runPipeline(request(), harness().callbacks)).toEqual({ kind: 'failed', stage: 'research', message })
    expect(sent).toHaveLength(1)
  })

  it('keeps the usage and model of a billed failure on its trace line', async () => {
    serve([() => stageFailed(502, LABEL, false, { usage: USAGE, model: 'nvidia/nemotron-content-safety' })])
    const h = harness()
    await runPipeline(request(), h.callbacks)
    expect(h.calls[0].usage).toEqual(USAGE)
    expect(h.calls[0].model).toBe('nvidia/nemotron-content-safety')
  })

  it('treats a reply with no trace as an unexpected failure and does not retry it', async () => {
    const sent = serve([() => json(200, { result: 'some text' })])
    expect(await runPipeline(request(), harness().callbacks)).toEqual({
      kind: 'failed',
      stage: 'research',
      message: 'Something went wrong. Please retry.',
    })
    expect(sent).toHaveLength(1)
  })

  it('stops quietly when the browser stops the run', async () => {
    serve([
      sent => new Promise<Response>((_resolve, reject) => {
        sent.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
      }),
    ])
    const controller = new AbortController()
    const h = harness()

    const pending = runPipeline(request({}, controller.signal), h.callbacks)
    controller.abort()
    expect(await pending).toEqual({ kind: 'stopped', stage: 'research' })
    expect(h.calls).toHaveLength(0)
  })
})
