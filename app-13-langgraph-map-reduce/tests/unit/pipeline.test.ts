import { describe, expect, it } from 'vitest'
import { RunBudget } from '../../netlify/shared/budget'
import { BUDGET_MESSAGE, ProviderError } from '../../netlify/shared/errors'
import { CHECK_MODEL, EXTRACT_MODEL, RETRY_PAUSE_MS, SYNTH_MODEL } from '../../netlify/shared/models'
import type { ChatFn, ChatReply, ChatRequest } from '../../netlify/shared/openrouter'
import { runPipeline } from '../../netlify/shared/pipeline'
import type { Frame, RunResult } from '../../src/types/frames'

/** One paragraph of about 1,000 characters. Two cannot share a 1,200 character chunk, so N paragraphs make N chunks. */
function paragraph(n: number): string {
  return Array.from({ length: 120 }, (_, i) => `term${n}w${i}`).join(' ') + '.'
}

function document(count: number): string {
  return Array.from({ length: count }, (_, i) => paragraph(i + 1)).join('\n')
}

const THREE = document(3)
const FIVE = document(5)

function reply(text: string, model: string): ChatReply {
  return {
    text,
    finishReason: 'stop',
    servedModel: model,
    usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
    cost: null,
  }
}

const lastMessage = (request: ChatRequest): string => request.messages[request.messages.length - 1]?.content ?? ''
const chunkOf = (user: string): number => Number(/^Chunk (\d+) of/.exec(user)?.[1])
/** The chunk numbers that have key points in a synthesis prompt. */
const citedIds = (user: string): number[] => [...new Set([...user.matchAll(/\[chunk (\d+)\]/g)].map((m) => Number(m[1])))]

const extractReply = (id: number): ChatReply =>
  reply(JSON.stringify({ points: [`Chunk ${id} states its rule.`], entities: ['The Lessor'] }), EXTRACT_MODEL)

const synthReply = (overview: string, ids: number[]): ChatReply =>
  reply(
    JSON.stringify({
      overview,
      sections: [{ heading: 'Terms', points: ids.map((id) => ({ text: `Rule ${id} holds.`, chunks: [id] })) }],
    }),
    SYNTH_MODEL,
  )

const noOmissions = (): ChatReply => reply(JSON.stringify({ omitted: [] }), CHECK_MODEL)

/** Never answers on its own. It rejects with the run's reason as soon as the run stops. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

interface Collected {
  frames: Frame[]
  results: RunResult[]
  errors: string[]
}

/** Runs the pipeline against a scripted model layer and collects every frame it sends. */
async function run(source: string, chat: ChatFn, budget: RunBudget = new RunBudget(60_000)): Promise<Collected> {
  const frames: Frame[] = []
  try {
    await runPipeline({
      text: source,
      budget,
      chat,
      retryPauseMs: 0,
      sink: (frame) => {
        frames.push(frame)
      },
    })
  } finally {
    budget.dispose()
  }
  return {
    frames,
    results: frames.flatMap((f) => (f.type === 'result' ? [f.result] : [])),
    errors: frames.flatMap((f) => (f.type === 'error' ? [f.message] : [])),
  }
}

describe('a retry pass that fails keeps the first-pass summary', () => {
  it('returns the first-pass summary with a notice when the retry synthesis times out', async () => {
    const attempts = new Map<number, number>()
    let synthCalls = 0
    const chat: ChatFn = async (request) => {
      const user = lastMessage(request)
      if (request.model === EXTRACT_MODEL) {
        const id = chunkOf(user)
        attempts.set(id, (attempts.get(id) ?? 0) + 1)
        if (id === 2 && attempts.get(2) === 1) throw new ProviderError('timeout')
        return extractReply(id)
      }
      if (request.model === CHECK_MODEL) return noOmissions()
      synthCalls += 1
      if (synthCalls === 1) return synthReply('First pass summary.', citedIds(user))
      throw new ProviderError('timeout')
    }

    const { errors, results } = await run(THREE, chat)

    expect(errors).toEqual([])
    expect(synthCalls).toBe(2)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      summary: { overview: 'First pass summary.' },
      coverage: { covered: [1, 3], missing: [2] },
      retries: 0,
      notice: 'The retry did not finish. The AI provider did not answer in time. The summary is from the first pass.',
    })
  })

  it('returns the first-pass summary when a rejected key arrives during the retry', async () => {
    const attempts = new Map<number, number>()
    const chat: ChatFn = async (request) => {
      const user = lastMessage(request)
      if (request.model === EXTRACT_MODEL) {
        const id = chunkOf(user)
        attempts.set(id, (attempts.get(id) ?? 0) + 1)
        if (id === 2 && attempts.get(2) === 1) throw new ProviderError('timeout')
        if (id === 2) throw new ProviderError('rejected')
        return extractReply(id)
      }
      if (request.model === CHECK_MODEL) return noOmissions()
      return synthReply('First pass summary.', citedIds(user))
    }

    const { errors, results } = await run(THREE, chat)

    expect(errors).toEqual([])
    expect(results[0]).toMatchObject({
      summary: { overview: 'First pass summary.' },
      coverage: { missing: [2] },
      notice:
        'The retry did not finish. The AI provider rejected the key or is out of credit. The summary is from the first pass.',
    })
  })

  it('returns the first-pass summary when the run budget runs out during the retry', async () => {
    const budget = new RunBudget(60_000)
    const attempts = new Map<number, number>()
    const chat: ChatFn = async (request, signal) => {
      const user = lastMessage(request)
      if (request.model === EXTRACT_MODEL) {
        const id = chunkOf(user)
        attempts.set(id, (attempts.get(id) ?? 0) + 1)
        if (id === 2 && attempts.get(2) === 1) throw new ProviderError('timeout')
        if (id === 2) {
          budget.cancel()
          return untilAborted(signal)
        }
        return extractReply(id)
      }
      if (request.model === CHECK_MODEL) return noOmissions()
      return synthReply('First pass summary.', citedIds(user))
    }

    const { errors, results } = await run(THREE, chat, budget)

    expect(errors).toEqual([])
    expect(results[0]).toMatchObject({
      summary: { overview: 'First pass summary.' },
      coverage: { missing: [2] },
      notice: `The retry did not finish. ${BUDGET_MESSAGE} The summary is from the first pass.`,
    })
  })

  it('ends with an error frame when the first pass has no summary to keep', async () => {
    const chat: ChatFn = async (request) => {
      if (request.model === EXTRACT_MODEL) return extractReply(chunkOf(lastMessage(request)))
      if (request.model === CHECK_MODEL) return noOmissions()
      throw new ProviderError('timeout')
    }

    const { errors, results } = await run(THREE, chat)

    expect(results).toEqual([])
    expect(errors).toEqual(['The AI provider did not answer in time.'])
  })
})

describe('a fatal error halts the sibling calls', () => {
  it('ends the run at once with the key error, and a queued chunk never starts', async () => {
    const calls = new Map<number, number>()
    let stopped = 0
    const chat: ChatFn = (request, signal) => {
      const id = chunkOf(lastMessage(request))
      calls.set(id, (calls.get(id) ?? 0) + 1)
      if (id === 1) return Promise.reject(new ProviderError('rejected'))
      return untilAborted(signal).catch((err: unknown) => {
        stopped += 1
        throw err
      })
    }
    const started = Date.now()

    const { errors, results } = await run(FIVE, chat)

    expect(errors).toEqual(['The AI provider rejected the key or is out of credit.'])
    expect(results).toEqual([])
    expect([...calls.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect(stopped).toBe(3)
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})

describe('a rate limit on one chunk costs that chunk only', () => {
  it('re-runs the chunk in the retry pass and completes the run', async () => {
    const attempts = new Map<number, number>()
    const chat: ChatFn = async (request) => {
      const user = lastMessage(request)
      if (request.model === EXTRACT_MODEL) {
        const id = chunkOf(user)
        attempts.set(id, (attempts.get(id) ?? 0) + 1)
        if (id === 2 && attempts.get(2) === 1) throw new ProviderError('rate_limited')
        return extractReply(id)
      }
      if (request.model === CHECK_MODEL) return noOmissions()
      return synthReply('Summary.', citedIds(user))
    }

    const { errors, results, frames } = await run(THREE, chat)

    expect(errors).toEqual([])
    expect(frames).toContainEqual(
      expect.objectContaining({
        type: 'node_end',
        node: 'extract',
        chunk: 2,
        status: 'failed',
        message: 'Rate limited, try again in a minute.',
      }),
    )
    expect(results[0]).toMatchObject({ coverage: { covered: [1, 2, 3], missing: [] }, retries: 1, notice: null })
  })

  it('ends the run with the plain message when the synthesis call is rate limited', async () => {
    const chat: ChatFn = async (request) => {
      if (request.model === EXTRACT_MODEL) return extractReply(chunkOf(lastMessage(request)))
      if (request.model === CHECK_MODEL) return noOmissions()
      throw new ProviderError('rate_limited')
    }

    const { errors, results } = await run(THREE, chat)

    expect(results).toEqual([])
    expect(errors).toEqual(['Rate limited, try again in a minute.'])
  })

  it('keeps the pause before a retry at 1.5 seconds', () => {
    expect(RETRY_PAUSE_MS).toBe(1_500)
  })
})

describe('a refused request on one chunk costs that chunk only', () => {
  it('finishes the run with that chunk reported as missing', async () => {
    const chat: ChatFn = async (request) => {
      const user = lastMessage(request)
      if (request.model === EXTRACT_MODEL) {
        const id = chunkOf(user)
        if (id === 2) throw new ProviderError('bad_request')
        return extractReply(id)
      }
      if (request.model === CHECK_MODEL) return noOmissions()
      return synthReply('Summary.', citedIds(user))
    }

    const { errors, results } = await run(THREE, chat)

    expect(errors).toEqual([])
    expect(results[0]).toMatchObject({ coverage: { covered: [1, 3], missing: [2] }, retries: 1, notice: null })
  })

  it('reports the plain message when every chunk is refused and nothing can be summarized', async () => {
    const chat: ChatFn = async (request) => {
      if (request.model === EXTRACT_MODEL) throw new ProviderError('bad_request')
      if (request.model === CHECK_MODEL) return noOmissions()
      throw new Error('synthesis must not run without key points')
    }

    const { errors, results } = await run(THREE, chat)

    expect(results).toEqual([])
    expect(errors).toEqual(['The AI provider rejected the request.'])
  })
})
