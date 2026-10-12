import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { config } from '../../netlify/functions/synthesize'
import runFunction, { config as runConfig } from '../../netlify/functions/run'
import { RunBudget } from '../../netlify/shared/budget'
import { ProviderError } from '../../netlify/shared/errors'
import { splitText } from '../../netlify/shared/chunk'
import { validateSynthesizeBody } from '../../netlify/shared/guard'
import { makeHandoff, openHandoff } from '../../netlify/shared/handoff'
import { createRunHandler, createSynthesizeHandler } from '../../netlify/shared/handler'
import { mergeFindings } from '../../netlify/shared/merge'
import { MODEL, SYNTH_CALL_TIMEOUT_MS } from '../../netlify/shared/models'
import type { ChatFn, ChatReply, ChatRequest } from '../../netlify/shared/openrouter'
import { runPipeline } from '../../netlify/shared/pipeline'
import { MODELS_URL, resetPriceCache } from '../../netlify/shared/prices'
import { IDLE_TIMEOUT_MS, runAnalysis } from '../../src/lib/api'
import type { Finding, Frame, Handoff, Merged, RunResult } from '../../src/types/frames'
import { attributionText } from '../helpers/attribute'
import { modelsResponse, recordedModels, SERVED_MODEL } from '../helpers/prices'
import { FixedBudget, runSplit } from '../helpers/split'
import { roleOf } from '../helpers/roles'

const paragraph = (n: number): string => Array.from({ length: 120 }, (_, i) => `term${n}w${i}`).join(' ') + '.'
/** Three paragraphs of about 1,000 characters make three chunks. */
const THREE = [1, 2, 3].map(paragraph).join('\n')

const finding = (chunkId: number, points: string[], entities: string[] = []): Finding => ({ chunkId, points, entities, model: null, usage: null })
const goodMerged = (): Merged =>
  mergeFindings([finding(1, ['Rule one.', 'Detail one.'], ['Lessor']), finding(2, ['Rule two.'], ['Lessee']), finding(3, ['Rule three.', 'Detail three.'])])
const KEY = 'test-only-placeholder'
/** The body request 2 gets: the text, and the hand-off request 1 signed for `merged` (which a test can have altered before signing). */
const body = (merged: unknown = goodMerged(), text: unknown = THREE): unknown => ({ text, handoff: makeHandoff(KEY, String(text), merged as Merged) })

describe('the synthesis request trusts nothing the browser sends back', () => {
  it('accepts the hand-off the extract request made, and rebuilds the chunks and findings itself', () => {
    const checked = validateSynthesizeBody(body(), KEY)

    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.text).toBe(THREE)
    expect(checked.resume.chunks).toEqual(splitText(THREE))
    expect(checked.resume.merged).toEqual(goodMerged())
    expect(checked.resume.findings.map((f) => f.chunkId)).toEqual([1, 2, 3])
  })

  it('applies the same text rules as the extract request', () => {
    expect(validateSynthesizeBody(body(goodMerged(), 'short'), KEY)).toMatchObject({ ok: false, status: 400 })
    expect(validateSynthesizeBody(body(goodMerged(), 42), KEY)).toMatchObject({ ok: false, status: 400 })
    expect(validateSynthesizeBody('nope', KEY)).toMatchObject({ ok: false, status: 400 })
  })

  const ABSENT = Symbol('absent')
  const mutate = (change: (m: Merged) => void): unknown => {
    const merged = structuredClone(goodMerged())
    change(merged)
    return merged
  }

  it.each([
    ['no merged object', ABSENT],
    ['byChunk that is not a list', { byChunk: 'x' }],
    ['no chunk at all', { byChunk: [] }],
    ['a chunk number the text does not have', mutate((m) => void (m.byChunk[2]!.chunkId = 4))],
    ['a chunk number the text does not have, with ids that match it', mutate((m) => void ((m.byChunk[2]!.chunkId = 4), m.byChunk[2]!.points.forEach((p, i) => (p.id = `4.${i + 1}`))))],
    ['a chunk number twice', mutate((m) => void (m.byChunk[1]!.chunkId = 1))],
    ['chunks out of order', mutate((m) => void m.byChunk.reverse())],
    ['a chunk number that is not an integer', mutate((m) => void (m.byChunk[0]!.chunkId = 1.5))],
    ['a forged point id', mutate((m) => void (m.byChunk[0]!.points[1]!.id = '9.9'))],
    ['a point id from another chunk', mutate((m) => void (m.byChunk[1]!.points[0]!.id = '1.1'))],
    ['a point id out of position', mutate((m) => void (m.byChunk[0]!.points[0]!.id = '1.2'))],
    ['a point id that is not text', mutate((m) => void ((m.byChunk[0]!.points[0] as { id: unknown }).id = 1.1))],
    ['a chunk with no points', mutate((m) => void (m.byChunk[1]!.points = []))],
    ['seven points in a chunk', mutate((m) => void (m.byChunk[0]!.points = Array.from({ length: 7 }, (_, i) => ({ id: `1.${i + 1}`, text: `P${i}.` }))))],
    ['a point text that is not text', mutate((m) => void ((m.byChunk[0]!.points[0] as { text: unknown }).text = 7))],
    ['a blank point text', mutate((m) => void (m.byChunk[0]!.points[0]!.text = '   '))],
    ['a point text of 301 characters', mutate((m) => void (m.byChunk[0]!.points[0]!.text = 'x'.repeat(301)))],
    ['a repeated point text, which the extract request would have merged', mutate((m) => void (m.byChunk[0]!.points[1]!.text = 'rule one.'))],
    ['a point text with unclean spacing, which the extract request would have cleaned', mutate((m) => void (m.byChunk[0]!.points[0]!.text = 'Rule  one.'))],
    ['entities that are not a list', mutate((m) => void ((m.byChunk[0] as { entities: unknown }).entities = 'Lessor'))],
    ['an entity that is not text', mutate((m) => void ((m.byChunk[0]!.entities as unknown[])[0] = {}))],
    ['an entity of 81 characters', mutate((m) => void (m.byChunk[0]!.entities[0] = 'x'.repeat(81)))],
    ['thirteen entities in a chunk', mutate((m) => void (m.byChunk[0]!.entities = Array.from({ length: 13 }, (_, i) => `E${i}`)))],
  ])('refuses %s', (_name, merged) => {
    const checked = validateSynthesizeBody(merged === ABSENT ? { text: THREE } : body(merged), KEY)

    expect(checked).toMatchObject({ ok: false, status: 400 })
    if (!checked.ok) expect(checked.error).toMatch(/key points|text|JSON/i)
  })

  it('takes the entities and the finding count from the points, never from fields the browser adds', () => {
    const merged = { ...structuredClone(goodMerged()), entities: ['Forged'], findingCount: 99 }
    const checked = validateSynthesizeBody(body(merged), KEY)

    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.resume.merged.entities).toEqual(['Lessor', 'Lessee'])
    expect(checked.resume.merged.findingCount).toBe(3)
  })
})

// --- the two phases of the pipeline ----------------------------------------------------------

const reply = (text: string): ChatReply => ({ text, finishReason: 'stop', servedModel: MODEL, usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } })
const lastMessage = (request: ChatRequest): string => request.messages[request.messages.length - 1]?.content ?? ''

function chatScript(seen: ChatRequest[] = [], important: string[] = []): ChatFn {
  return async (request) => {
    seen.push(request)
    const user = lastMessage(request)
    const role = roleOf(request)
    if (role === 'extract') {
      const id = Number(/^Chunk (\d+) of/.exec(user)?.[1])
      return reply(JSON.stringify({ points: [`Chunk ${id} rule.`, `Chunk ${id} detail.`], entities: [`Party ${id}`] }))
    }
    if (role === 'attribute') return reply(attributionText(user))
    if (role === 'check') return reply(JSON.stringify({ important }))
    const ids = [...new Set([...user.matchAll(/\[chunk (\d+)\]/g)].map((m) => Number(m[1])))]
    return reply(JSON.stringify({ overview: 'A lease.', sections: [{ heading: 'Terms', points: ids.map((id) => ({ text: `Rule ${id}.`, chunks: [id] })) }] }))
  }
}

/** Request 1 alone, to see what it does and does not call. */
async function runFirst(chat: ChatFn): Promise<Frame[]> {
  const frames: Frame[] = []
  const budget = new RunBudget(60_000)
  try {
    await runPipeline({ text: THREE, budget, chat, models: Promise.resolve(recordedModels()), retryPauseMs: 0, phase: 'extract', sealKey: KEY, sink: (f) => frames.push(f) })
  } finally {
    budget.dispose()
  }
  return frames
}

const kinds = (frames: Frame[]): string[] => frames.map((f) => (f.type === 'node_end' ? `end ${f.node}` : f.type === 'node_start' ? `start ${f.node}` : f.type))

describe('request 1 splits and extracts, then hands the signed key points to the browser', () => {
  it('runs split, extract and reduce, makes no synthesis call, and ends with a hand-off in place of a result', async () => {
    const seen: ChatRequest[] = []
    const frames = await runFirst(chatScript(seen))

    expect(seen.map((r) => roleOf(r))).toEqual(['extract', 'extract', 'extract'])
    expect(kinds(frames).filter((k) => k.startsWith('end '))).toEqual(['end split', 'end extract', 'end extract', 'end extract', 'end reduce'])
    expect(frames.filter((f) => f.type === 'result' || f.type === 'error')).toEqual([])
    const handoff = frames.find((f) => f.type === 'handoff')
    expect(handoff?.type === 'handoff' && openHandoff(KEY, THREE, handoff.handoff)).toMatchObject({
      findingCount: 3,
      byChunk: [{ chunkId: 1, points: [{ id: '1.1', text: 'Chunk 1 rule.' }, { id: '1.2', text: 'Chunk 1 detail.' }] }, {}, {}],
    })
    // The hand-off is the last frame, and request 2 opens it only for this key and this text.
    expect(frames.at(-1)?.type).toBe('handoff')
    expect(handoff?.type === 'handoff' && openHandoff('another-key', THREE, handoff.handoff)).toBeNull()
  })

  it('ends with the plain error, and no hand-off, when no chunk gave key points', async () => {
    const chat: ChatFn = async () => reply(JSON.stringify({ points: [], entities: [] }))
    const frames = await runFirst(chat)

    expect(frames.filter((f) => f.type === 'handoff')).toEqual([])
    expect(frames.filter((f) => f.type === 'error')).toEqual([{ type: 'error', message: 'The model reply had no key points.' }])
  })
})

describe('request 2 writes the summary from the hand-off, as production runs it', () => {
  it('runs synthesis, the key point check, the review and the final step only, with the synthesis timeout, and returns the result', async () => {
    const seen: ChatRequest[] = []
    const run = await runSplit(THREE, chatScript(seen, ['1.2']))

    // Request 1 made the three extract calls, request 2 everything after them.
    expect(seen.map((r) => roleOf(r)).slice(3)).toEqual(['synthesize', 'attribute', 'attribute', 'attribute', 'check'])
    expect(seen[3]?.timeoutMs).toBe(SYNTH_CALL_TIMEOUT_MS)
    expect(run.second.some((f) => f.type === 'node_start' && f.node === 'split')).toBe(false)
    // The check step starts once, then once more for each chunk's key point check.
    expect([...new Set(kinds(run.second).filter((k) => k.startsWith('start ')))]).toEqual(['start synthesize', 'start check', 'start final'])
    expect(run.errors).toEqual([])
    expect(run.results[0]).toMatchObject({
      chunkCount: 3,
      findingCount: 3,
      entities: ['Party 1', 'Party 2', 'Party 3'],
      retryOutcome: 'none',
      coverage: { covered: [1, 2, 3], missing: [], citedPoints: ['1.1', '1.2', '2.1', '3.1'], uncitedPoints: ['2.2', '3.2'], unchecked: [] },
      reviewFlags: ['1.2'],
      review: 'done',
    })
    expect(run.results[0]?.keyPoints[0]?.points[0]).toEqual({ id: '1.1', text: 'Chunk 1 rule.' })
  })

  it('carries a chunk request 1 could not extract into request 2, which reports it when nobody had time to ask again', async () => {
    let tries = 0
    const base = chatScript()
    const flaky: ChatFn = async (request, signal) => {
      if (roleOf(request) === 'extract' && /^Chunk 2 of/.test(request.messages[1]?.content ?? '') && (tries += 1) === 1) throw new ProviderError('timeout')
      return base(request, signal)
    }

    // Request 1 had no time to retry (its budget is nearly spent), and request 2 has none either: the chunk is reported missing.
    const slow = await runSplit(THREE, flaky, { budgetFirst: new FixedBudget(5_000), budgetSecond: new FixedBudget(5_000) })
    expect(slow.merged?.byChunk.map((c) => c.chunkId)).toEqual([1, 3])
    expect(slow.results[0]).toMatchObject({ retryOutcome: 'skipped', coverage: { missing: [2], noPoints: [2] } })

    // With time, request 1 asks again itself, and request 2 receives the chunk.
    tries = 0
    const roomy = await runSplit(THREE, flaky)
    expect(roomy.merged?.byChunk.map((c) => c.chunkId)).toEqual([1, 2, 3])
    expect(roomy.results[0]).toMatchObject({ retryOutcome: 'used', retries: 1, coverage: { missing: [], covered: [1, 2, 3] } })
    expect(roomy.results[0]?.keyPoints.map((k) => k.chunk)).toEqual([1, 2, 3])
  })
})

// --- the endpoints ----------------------------------------------------------------------------

const ORIGIN = 'https://jdgafx-app-13-langgraph-map-reduce.netlify.app'
const post = (path: string, value: unknown): Request =>
  new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(value) })

function providerFetch() {
  return vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    if (url === MODELS_URL) return modelsResponse()
    const sent = JSON.parse(String(init.body)) as { max_tokens: number; messages: Array<{ content: string }> }
    const user = sent.messages[sent.messages.length - 1]?.content ?? ''
    const role = roleOf(sent)
    const content =
      role === 'extract'
        ? JSON.stringify({ points: [`Chunk ${/^Chunk (\d+) of/.exec(user)?.[1]} rule.`, 'A detail.'], entities: ['The Lessor'] })
        : role === 'attribute'
          ? attributionText(user)
          : role === 'check'
            ? JSON.stringify({ important: [] })
            : JSON.stringify({ overview: 'A lease.', sections: [{ heading: 'Terms', points: [{ text: 'Rules 1, 2 and 3 hold.', chunks: [1, 2, 3] }] }] })
    return new Response(JSON.stringify({ model: SERVED_MODEL, choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

const framesOf = (text: string): Frame[] =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('data: {'))
    .map((b) => JSON.parse(b.slice(6)) as Frame)

describe('the two endpoints', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_API_KEY', KEY)
    resetPriceCache()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('serves request 1 at /api/run and request 2 at /api/synthesize', () => {
    expect(runConfig.path).toBe('/api/run')
    expect(config.path).toBe('/api/synthesize')
  })

  it('the extract function ends in a hand-off, and the synthesis function turns it into the result', async () => {
    vi.stubGlobal('fetch', providerFetch())
    const first = framesOf(await (await runFunction(post('/api/run', { text: THREE }))).text())
    const handoff = first.find((f) => f.type === 'handoff') as { handoff: Handoff }
    expect(first.some((f) => f.type === 'result')).toBe(false)

    const second = framesOf(await (await handler(post('/api/synthesize', { text: THREE, handoff: handoff.handoff }))).text())
    const result = second.find((f) => f.type === 'result') as { result: RunResult }
    expect(result.result.coverage).toMatchObject({ covered: [1, 2, 3], citedPoints: ['1.1', '2.1', '3.1'], uncitedPoints: ['1.2', '2.2', '3.2'] })
    expect(second.some((f) => f.type === 'error')).toBe(false)
  })

  it('refuses changed key points, or the same key points under another text, with a plain 400 and no model call', async () => {
    const stub = providerFetch()
    vi.stubGlobal('fetch', stub)
    const signed = makeHandoff(KEY, THREE, goodMerged())
    const changed = JSON.parse(signed.text) as { merged: Merged }
    changed.merged.byChunk[0]!.points[0]!.text = 'The lease is void.'

    for (const sent of [
      { text: THREE, handoff: { text: JSON.stringify(changed), seal: signed.seal } },
      { text: `${THREE}\nAdded afterwards.`, handoff: signed },
      { text: THREE, handoff: makeHandoff('another-key', THREE, goodMerged()) },
      { text: THREE },
    ]) {
      const response = await handler(post('/api/synthesize', sent))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ success: false, error: expect.stringMatching(/key points/) })
    }
    expect(stub).not.toHaveBeenCalled()
  })

  it.each([
    ['a bad origin', { Origin: 'https://evil.example' }, 403],
  ])('applies the same guards as /api/run: %s', async (_name, headers, status) => {
    const request = new Request(`${ORIGIN}/api/synthesize`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ text: THREE, handoff: makeHandoff(KEY, THREE, goodMerged()) }) })
    expect((await handler(request)).status).toBe(status)
  })

  it('answers 503 without a key, and 405 to a GET', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    expect((await handler(post('/api/synthesize', { text: THREE, handoff: makeHandoff(KEY, THREE, goodMerged()) }))).status).toBe(503)
    vi.stubEnv('OPENROUTER_API_KEY', KEY)
    expect((await handler(new Request(`${ORIGIN}/api/synthesize`, { method: 'GET' }))).status).toBe(405)
  })

  it('keeps the full pipeline available to callers that ask for it', async () => {
    vi.stubGlobal('fetch', providerFetch())
    const all = framesOf(await (await createRunHandler()(post('/api/run', { text: THREE }))).text())
    expect(all.some((f) => f.type === 'result')).toBe(true)
    expect(createSynthesizeHandler).toBeTypeOf('function')
  })
})

// --- the browser runs both requests ------------------------------------------------------------

const sse = (frames: Frame[]): Response => new Response(`${frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')}data: [DONE]\n\n`, { status: 200 })
const row = (node: 'split' | 'extract' | 'synthesize', extra: Partial<Extract<Frame, { type: 'node_end' }>> = {}): Frame => ({
  type: 'node_end',
  node,
  status: 'ok',
  ms: 100,
  detail: node,
  priceState: 'priced',
  cost: 0.001,
  usage: { total_tokens: 1000 },
  ...extra,
})
const RESULT: RunResult = {
  summary: { overview: 'o', sections: [] },
  coverage: { covered: [1], missing: [], noPoints: [], citedPoints: ['1.1'], uncitedPoints: [], unchecked: [] },
  entities: [],
  retries: 0,
  chunkCount: 1,
  findingCount: 1,
  keyPoints: [],
  reviewFlags: [],
  review: 'not-needed',
  notice: null,
  retryOutcome: 'none',
  metrics: { totalMs: 5, totalTokens: 1000, totalCost: 0.001, priceNote: null, cheapCost: null, cheapCalls: 0, synthesisCost: 0.001, unreportedCalls: 0 },
}

describe('runAnalysis posts the hand-off to the second request', () => {
  afterEach(() => vi.unstubAllGlobals())
  const handoff = makeHandoff(KEY, THREE, goodMerged())

  it('sends the text and the signed hand-off unread, hides the hand-off frame, and totals both requests', async () => {
    const calls: Array<{ url: string; body: { text: string; handoff?: Handoff } }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) as { text: string; handoff?: Handoff } })
        return url === '/api/run' ? sse([row('split'), row('extract'), { type: 'handoff', handoff }]) : sse([row('synthesize', { cost: 0.004 }), { type: 'result', result: RESULT }])
      }),
    )
    const frames: Frame[] = []

    await runAnalysis(THREE, (f) => frames.push(f), new AbortController().signal)

    expect(calls.map((c) => c.url)).toEqual(['/api/run', '/api/synthesize'])
    expect(calls[0]?.body).toEqual({ text: THREE })
    expect(calls[1]?.body).toEqual({ text: THREE, handoff })
    expect(frames.some((f) => f.type === 'handoff')).toBe(false)
    expect(frames.map((f) => f.type)).toEqual(['node_end', 'node_end', 'node_end', 'result'])
    // The result's metrics cover the rows of both requests.
    const result = frames.at(-1) as { result: RunResult }
    expect(result.result.metrics.totalTokens).toBe(3000)
    expect(result.result.metrics.totalCost).toBeCloseTo(0.006, 9)
    expect(result.result.metrics.totalMs).toBeGreaterThanOrEqual(0)
  })

  it('starts no second request when the first ends with an error', async () => {
    const fetchStub = vi.fn(async () => sse([{ type: 'error', message: 'The AI provider did not answer in time.' }]))
    vi.stubGlobal('fetch', fetchStub)
    const frames: Frame[] = []

    await runAnalysis(THREE, (f) => frames.push(f), new AbortController().signal)

    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(frames).toEqual([{ type: 'error', message: 'The AI provider did not answer in time.' }])
  })

  it('shows the server message when the second request is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url === '/api/run' ? sse([{ type: 'handoff', handoff }]) : new Response(JSON.stringify({ success: false, error: 'The key points did not match this text. Run the analysis again.' }), { status: 400 }))),
    )

    await expect(runAnalysis(THREE, () => undefined, new AbortController().signal)).rejects.toThrow('The key points did not match this text. Run the analysis again.')
  })

  it('gives the second request its own watchdog, so a stall in it ends the run', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => (url === '/api/run' ? sse([{ type: 'handoff', handoff }]) : new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), { status: 200 }))),
      )
      let outcome = 'pending'
      runAnalysis(THREE, () => undefined, new AbortController().signal).then(
        () => (outcome = 'resolved'),
        (e: unknown) => (outcome = e instanceof Error ? e.message : 'rejected'),
      )
      await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 1)

      expect(outcome).toMatch(/connection stopped answering/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not start the second request after Stop', async () => {
    const controller = new AbortController()
    const fetchStub = vi.fn(async () => {
      controller.abort()
      return sse([{ type: 'handoff', handoff }])
    })
    vi.stubGlobal('fetch', fetchStub)

    await runAnalysis(THREE, () => undefined, controller.signal).catch(() => undefined)

    expect(fetchStub).toHaveBeenCalledTimes(1)
  })
})
