import { describe, expect, it } from 'vitest'
import { createLimiter, RunBudget } from '../../netlify/shared/budget'
import { ProviderError, type ProviderKind } from '../../netlify/shared/errors'
import { buildGraph } from '../../netlify/shared/graph'
import { MODEL } from '../../netlify/shared/models'
import { isCheck, isExtract } from '../helpers/roles'
import type { ChatFn, ChatReply, ChatRequest } from '../../netlify/shared/openrouter'
import type { Frame, Outcome } from '../../src/types/frames'

/** Three paragraphs of about 1,000 characters each: two cannot share a 1,200 character chunk, so they make 3 chunks. */
function paragraph(n: number): string {
  return Array.from({ length: 120 }, (_, i) => `term${n}w${i}`).join(' ') + '.'
}
const THREE_CHUNKS = [1, 2, 3].map(paragraph).join('\n')

interface Script {
  /** chunk id -> number of extract calls that time out before one succeeds */
  failExtract?: Record<number, number>
  /** chunk id whose extract call fails with a fatal rejection */
  rejectChunk?: number
  /** chunk ids the review model flags on the first check only */
  flagFirstCheck?: number[]
  /** the review model fails with this kind on every call: coverage falls back to chunk citations */
  reviewFailure?: ProviderKind
}

function answer(text: string, model: string): ChatReply {
  return {
    text,
    finishReason: 'stop',
    servedModel: model,
    usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
    cost: null,
  }
}

/** A model layer that answers by model id, with the failures the script asks for. */
function mockChat(script: Script = {}): ChatFn {
  const attempts = new Map<number, number>()
  let checks = 0
  return async (request: ChatRequest): Promise<ChatReply> => {
    const user = request.messages[request.messages.length - 1]?.content ?? ''
    if (isExtract(request)) {
      const id = Number(/^Chunk (\d+) of/.exec(user)?.[1])
      const seen = (attempts.get(id) ?? 0) + 1
      attempts.set(id, seen)
      if (script.rejectChunk === id) throw new ProviderError('rejected')
      if (seen <= (script.failExtract?.[id] ?? 0)) throw new ProviderError('timeout')
      return answer(
        JSON.stringify({
          points: [`Chunk ${id} states its main rule.`, `Chunk ${id} sets a deadline.`],
          entities: ['The Lessor', `Party ${id}`],
        }),
        MODEL,
      )
    }
    if (isCheck(request)) {
      checks += 1
      if (script.reviewFailure) throw new ProviderError(script.reviewFailure)
      const omitted = checks === 1 ? (script.flagFirstCheck ?? []) : []
      return answer(JSON.stringify({ omitted }), MODEL)
    }
    // Synthesize cites every chunk that has key points, and only those.
    const ids = [...new Set([...user.matchAll(/\[chunk (\d+)\]/g)].map((m) => Number(m[1])))]
    const points = ids.map((id) => ({ text: `Chunk ${id} rule is kept.`, chunks: [id] }))
    return answer(
      JSON.stringify({ overview: 'A lease between two parties.', sections: [{ heading: 'Terms', points }] }),
      MODEL,
    )
  }
}

interface RunOutput {
  path: string[]
  frames: Frame[]
  final: Outcome | null
}

/** Streams one run and records the node path (from updates), the custom frames and the final outcome. */
async function runGraph(text: string, chat: ChatFn): Promise<RunOutput> {
  const budget = new RunBudget(60_000)
  const graph = buildGraph({ chat, limiter: createLimiter(4), budget, retryPauseMs: 0 })
  const out: RunOutput = { path: [], frames: [], final: null }
  try {
    const stream = await graph.stream(
      { text },
      { streamMode: ['custom', 'updates'] },
    )
    for await (const [mode, payload] of stream) {
      if (mode === 'custom') {
        out.frames.push(payload as Frame)
      } else {
        out.path.push(...Object.keys(payload as object))
        const update = (payload as { final?: { outcome?: Outcome | null } }).final
        if (update?.outcome) out.final = update.outcome
      }
    }
  } finally {
    budget.dispose()
  }
  return out
}

const edges = (frames: Frame[]): string[] =>
  frames.flatMap((f) => (f.type === 'edge' ? [`${f.from} -> ${f.to}: ${f.label}`] : []))

describe('graph path and state', () => {
  it('(a) three chunks, all covered: each node runs once per chunk and the run finishes', async () => {
    const run = await runGraph(THREE_CHUNKS, mockChat())

    expect(run.path[0]).toBe('split')
    expect(run.path.slice(4)).toEqual(['reduce', 'synthesize', 'check', 'final'])
    expect([...run.path].sort()).toEqual(
      ['check', 'extract', 'extract', 'extract', 'final', 'reduce', 'split', 'synthesize'].sort(),
    )
    expect(run.path).toHaveLength(8)

    expect(run.final?.coverage).toEqual({ covered: [1, 2, 3], missing: [], noPoints: [] })
    expect(run.final?.retries).toBe(0)
    expect(run.final?.chunkCount).toBe(3)
    expect(run.final?.findingCount).toBe(3)
    expect(run.final?.entities).toEqual(['The Lessor', 'Party 1', 'Party 2', 'Party 3'])
    expect(run.final?.summary.sections[0]?.points.map((p) => p.chunks)).toEqual([[1], [2], [3]])
    expect(edges(run.frames)).toEqual([
      'split -> extract: fan out: 3 chunks',
      'check -> final: coverage complete',
    ])
  })

  it('(a2) a one-chunk text says "1 chunk" and "1 finding" in every row and label', async () => {
    const run = await runGraph('The Lessor shall repair the roof within thirty days of written notice from the Lessee.', mockChat())

    const details = run.frames.flatMap((f) => (f.type === 'node_end' && f.node !== 'extract' ? [`${f.node}: ${f.detail}`] : []))
    expect(details).toEqual([
      'split: 1 chunk of about 1,200 characters',
      'reduce: Merged 1 finding into 1 chunk, 2 unique entities',
      expect.stringMatching(/^synthesize: /),
      expect.stringMatching(/^check: /),
      'final: 1 of 1 chunk covered',
    ])
    expect(edges(run.frames)).toEqual(['split -> extract: fan out: 1 chunk', 'check -> final: coverage complete'])
  })

  it('(b) one chunk times out on the first pass: only that chunk is re-run, once, then the run completes', async () => {
    const run = await runGraph(THREE_CHUNKS, mockChat({ failExtract: { 2: 1 } }))

    expect(run.path).toEqual([
      'split',
      'extract',
      'extract',
      'extract',
      'reduce',
      'synthesize',
      'check',
      'extract',
      'reduce',
      'synthesize',
      'check',
      'final',
    ])
    expect(run.final?.coverage).toEqual({ covered: [1, 2, 3], missing: [], noPoints: [] })
    expect(run.final?.retries).toBe(1)
    // The timed-out chunk produced no first-pass finding, so the retry supplies the only one for it.
    expect(run.final?.findingCount).toBe(3)
    expect(run.final?.entities).toEqual(['The Lessor', 'Party 1', 'Party 2', 'Party 3'])

    const failed = run.frames.flatMap((f) =>
      f.type === 'node_end' && f.status === 'failed' ? [`${f.node} ${f.chunk}: ${f.message}`] : [],
    )
    expect(failed).toEqual(['extract 2: The AI provider did not answer in time.'])
    expect(edges(run.frames)).toEqual([
      'split -> extract: fan out: 3 chunks',
      'check -> extract: retry 1 missing chunk',
      'check -> final: coverage complete',
    ])
  })

  it('(c) a chunk still missing after a retry that found nothing: the second synthesis is skipped and the gap is reported', async () => {
    const run = await runGraph(THREE_CHUNKS, mockChat({ failExtract: { 2: 99 } }))

    expect(run.path).toEqual([
      'split',
      'extract',
      'extract',
      'extract',
      'reduce',
      'synthesize',
      'check',
      'extract',
      'reduce',
      'final',
    ])
    expect(run.final?.coverage).toEqual({ covered: [1, 3], missing: [2], noPoints: [2] })
    expect(run.final?.retries).toBe(1)
    expect(run.final?.findingCount).toBe(2)
    expect(run.final?.retryOutcome).toBe('used-nothing-new')
    expect(run.final?.keyPoints).toEqual([
      { chunk: 1, points: ['Chunk 1 states its main rule.', 'Chunk 1 sets a deadline.'] },
      { chunk: 3, points: ['Chunk 3 states its main rule.', 'Chunk 3 sets a deadline.'] },
    ])
    expect(run.final?.summary.sections.length).toBeGreaterThan(0)
    expect(edges(run.frames)).toEqual([
      'split -> extract: fan out: 3 chunks',
      'check -> extract: retry 1 missing chunk',
      'check -> final: 1 chunk still missing after the retry',
    ])
  })

  it('(d) the review model flags a cited chunk: the flag is a note only, with no retry and no change to coverage', async () => {
    const run = await runGraph(THREE_CHUNKS, mockChat({ flagFirstCheck: [3] }))

    expect(run.path).toHaveLength(8)
    expect(run.final?.coverage).toEqual({ covered: [1, 2, 3], missing: [], noPoints: [] })
    expect(run.final?.reviewFlags).toEqual([3])
    expect(run.final?.retries).toBe(0)
    expect(run.final?.findingCount).toBe(3)
    expect(edges(run.frames)).toEqual([
      'split -> extract: fan out: 3 chunks',
      'check -> final: coverage complete',
    ])
  })

  it('(e) a rejected key ends the run at once with the provider error, not a partial result', async () => {
    await expect(runGraph(THREE_CHUNKS, mockChat({ rejectChunk: 1 }))).rejects.toBeInstanceOf(ProviderError)
  })

  it('(f) a review model that does not answer: the run still completes on chunk citations, with the check marked failed', async () => {
    const run = await runGraph(THREE_CHUNKS, mockChat({ reviewFailure: 'timeout' }))

    expect(run.path).toHaveLength(8)
    expect(run.final?.coverage).toEqual({ covered: [1, 2, 3], missing: [], noPoints: [] })
    const check = run.frames.find((f) => f.type === 'node_end' && f.node === 'check')
    expect(check).toMatchObject({ status: 'failed' })
    expect(check && 'detail' in check ? check.detail : '').toBe(
      'Review unavailable: The AI provider did not answer in time. Coverage uses chunk citations only.',
    )
  })

  it('(g) a review call the provider refuses (bad request) does not discard the finished summary', async () => {
    const run = await runGraph(THREE_CHUNKS, mockChat({ reviewFailure: 'bad_request' }))

    expect(run.path).toHaveLength(8)
    expect(run.final?.coverage).toEqual({ covered: [1, 2, 3], missing: [], noPoints: [] })
    expect(run.final?.summary.sections.length).toBeGreaterThan(0)
  })
})
