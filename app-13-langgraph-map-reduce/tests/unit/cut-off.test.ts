import { describe, expect, it } from 'vitest'
import { RunBudget } from '../../netlify/shared/budget'
import { MODEL } from '../../netlify/shared/models'
import type { ChatFn, ChatReply, ChatRequest } from '../../netlify/shared/openrouter'
import { runPipeline } from '../../netlify/shared/pipeline'
import type { Frame, RunResult } from '../../src/types/frames'
import { recordedModels } from '../helpers/prices'
import { withAttribution } from '../helpers/attribute'
import { isCheck, isExtract } from '../helpers/roles'

const CUT = 'The AI ran out of reply length, so the reply was cut off.'

/** Three chunks of about 1,000 characters each. */
const THREE = Array.from({ length: 3 }, (_, n) => Array.from({ length: 120 }, (_, i) => `term${n + 1}w${i}`).join(' ') + '.').join('\n')

const reply = (text: string, finishReason = 'stop'): ChatReply => ({
  text,
  finishReason,
  servedModel: MODEL,
  usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
})
const cut = (r: ChatReply): ChatReply => ({ ...r, finishReason: 'length' })

const lastMessage = (request: ChatRequest): string => request.messages[request.messages.length - 1]?.content ?? ''
const chunkOf = (user: string): number => Number(/^Chunk (\d+) of/.exec(user)?.[1])
const citedIds = (user: string): number[] => [...new Set([...user.matchAll(/\[chunk (\d+)\]/g)].map((m) => Number(m[1])))]

/** A whole extraction that parses fine. A cut reply is one of these with a length stop. */
const extractReply = (id: number): ChatReply => reply(JSON.stringify({ points: [`Chunk ${id} states its rule.`], entities: ['The Lessor'] }))
const synthReply = (ids: number[]): ChatReply =>
  reply(
    JSON.stringify({
      overview: 'Summary.',
      sections: [{ heading: 'Terms', points: ids.map((id) => ({ text: `Rule ${id} holds.`, chunks: [id] })) }],
    }),
  )
const noOmissions = (): ChatReply => reply(JSON.stringify({ important: [] }))

async function run(chat: ChatFn) {
  const frames: Frame[] = []
  const budget = new RunBudget(60_000)
  try {
    await runPipeline({
      text: THREE,
      budget,
      chat: withAttribution(chat),
      models: Promise.resolve(recordedModels()),
      retryPauseMs: 0,
      extractConcurrency: 4,
      sink: (frame) => {
        frames.push(frame)
      },
    })
  } finally {
    budget.dispose()
  }
  return {
    frames,
    results: frames.flatMap((f) => (f.type === 'result' ? [f.result] : [])) as RunResult[],
    errors: frames.flatMap((f) => (f.type === 'error' ? [f.message] : [])),
    extractRows: frames.flatMap((f) => (f.type === 'node_end' && f.node === 'extract' ? [f] : [])),
  }
}

describe('a reply cut off at the token cap is never used', () => {
  it('counts a cut extract as that chunk not extracted, even though its JSON parses, and shows it in the coverage', async () => {
    const synthSaw: number[][] = []
    const chat: ChatFn = async (request) => {
      const user = lastMessage(request)
      if (isExtract(request)) {
        const id = chunkOf(user)
        return id === 2 ? cut(extractReply(2)) : extractReply(id)
      }
      if (isCheck(request)) return noOmissions()
      synthSaw.push(citedIds(user))
      return synthReply(citedIds(user))
    }
    const { errors, results, extractRows } = await run(chat)

    expect(errors).toEqual([])
    expect(results).toHaveLength(1)
    expect(results[0].coverage).toMatchObject({ covered: [1, 3], missing: [2] })
    expect(results[0].keyPoints.map((k) => k.chunk)).toEqual([1, 3])
    expect(synthSaw[0]).not.toContain(2)
    expect(extractRows.filter((r) => r.chunk === 2 && r.status === 'failed').every((r) => r.message === CUT)).toBe(true)
    expect(extractRows.filter((r) => r.chunk === 2 && r.status === 'failed').length).toBeGreaterThan(0)
  })

  it('retries a cut chunk through the coverage retry, and merges it only when the retry reply is whole', async () => {
    const attempts = new Map<number, number>()
    const chat: ChatFn = async (request) => {
      const user = lastMessage(request)
      if (isExtract(request)) {
        const id = chunkOf(user)
        attempts.set(id, (attempts.get(id) ?? 0) + 1)
        return id === 2 && attempts.get(2) === 1 ? cut(extractReply(2)) : extractReply(id)
      }
      if (isCheck(request)) return noOmissions()
      return synthReply(citedIds(user))
    }
    const { errors, results } = await run(chat)
    expect(errors).toEqual([])
    expect(attempts.get(2)).toBe(2)
    expect(results[0]).toMatchObject({ retries: 1, coverage: { covered: [1, 2, 3], missing: [] } })
  })

  it('ends the run with the cut-off message, and no result, when every chunk is cut off', async () => {
    const chat: ChatFn = async (request) => {
      if (isExtract(request)) return cut(extractReply(chunkOf(lastMessage(request))))
      throw new Error('no later step may run')
    }
    const { errors, results } = await run(chat)
    expect(results).toEqual([])
    expect(errors).toEqual([CUT])
  })

  it('ends the run with the cut-off message when the synthesis is cut off but parses', async () => {
    const chat: ChatFn = async (request) => {
      const user = lastMessage(request)
      if (isExtract(request)) return extractReply(chunkOf(user))
      if (isCheck(request)) throw new Error('check must not run on a cut summary')
      return cut(synthReply(citedIds(user)))
    }
    const { errors, results } = await run(chat)
    expect(results).toEqual([])
    expect(errors).toEqual([`${CUT} Run the text again.`])
  })

  it('ignores the flags of a cut-off review and marks the review row failed', async () => {
    const chat: ChatFn = async (request) => {
      const user = lastMessage(request)
      // Two points per chunk, and the summary cites the first of each: the second is unused, so the review runs.
      if (isExtract(request)) {
        const id = chunkOf(user)
        return reply(JSON.stringify({ points: [`Chunk ${id} states its rule.`, `Chunk ${id} adds a detail.`], entities: [] }))
      }
      if (isCheck(request)) return cut(reply(JSON.stringify({ important: ['1.2'] })))
      return synthReply(citedIds(user))
    }
    const { errors, results, frames } = await run(chat)
    expect(errors).toEqual([])
    expect(results[0].reviewFlags).toEqual([])
    expect(results[0].review).toBe('unavailable')
    // The check step ends with the review row, after one row per chunk's key point check.
    expect(frames.filter((f) => f.type === 'node_end' && f.node === 'check').at(-1)).toMatchObject({
      status: 'failed',
      detail: 'Review reply was cut off. The unused key points are listed without it.',
    })
  })
})
