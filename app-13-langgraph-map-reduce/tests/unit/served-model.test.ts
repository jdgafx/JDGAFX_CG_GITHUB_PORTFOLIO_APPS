import { describe, expect, it } from 'vitest'
import { createLimiter, RunBudget } from '../../netlify/shared/budget'
import { buildGraph } from '../../netlify/shared/graph'
import { MODEL } from '../../netlify/shared/models'
import type { ChatFn, ChatReply, ChatRequest } from '../../netlify/shared/openrouter'
import { recordedModels, SERVED_MODEL } from '../helpers/prices'
import { isCheck, isExtract } from '../helpers/roles'

/** Three paragraphs of about 1,000 characters each: they make 3 chunks. */
const paragraph = (n: number): string => Array.from({ length: 120 }, (_, i) => `term${n}w${i}`).join(' ') + '.'
const THREE_CHUNKS = [1, 2, 3].map(paragraph).join('\n')

/** Every reply, in the given model's name: null means the reply names no model. */
function scripted(served: string | null): ChatFn {
  return async (request: ChatRequest): Promise<ChatReply> => {
    const user = request.messages[request.messages.length - 1]?.content ?? ''
    const text = isExtract(request)
      ? JSON.stringify({ points: [`Chunk ${/^Chunk (\d+) of/.exec(user)?.[1]} sets the rule.`], entities: ['The Lessor'] })
      : isCheck(request)
        ? JSON.stringify({ omitted: [] })
        : JSON.stringify({
            overview: 'A lease.',
            sections: [{ heading: 'Terms', points: [...new Set([...user.matchAll(/\[chunk (\d+)\]/g)].map((m) => Number(m[1])))].map((id) => ({ text: `Chunk ${id} rule.`, chunks: [id] })) }],
          })
    return { text, finishReason: 'stop', servedModel: served, usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } }
  }
}

/** Runs the graph to its end and returns the state the nodes wrote. */
async function runState(chat: ChatFn) {
  const budget = new RunBudget(60_000)
  try {
    const graph = buildGraph({ chat, limiter: createLimiter(4), budget, models: Promise.resolve(recordedModels()), retryPauseMs: 0 })
    return await graph.invoke({ text: THREE_CHUNKS })
  } finally {
    budget.dispose()
  }
}

describe('served model is never replaced by the requested alias', () => {
  it('leaves a finding without a served model as null, not the requested alias', async () => {
    const state = await runState(scripted(null))

    expect(state.findings.length).toBe(3)
    for (const finding of state.findings) expect(finding.model).toBeNull()
  })

  it('records the served model of each finding when the reply names one', async () => {
    const state = await runState(scripted(SERVED_MODEL))

    for (const finding of state.findings) expect(finding.model).toBe(SERVED_MODEL)
    expect(state.findings.map((f) => f.model)).not.toContain(MODEL)
  })

  it('records a reply without a served model as not-reported, with the newest model the list names', async () => {
    const state = await runState(scripted(null))

    const rows = state.trace.filter((row) => row.node === 'extract' || row.node === 'synthesize' || row.node === 'check')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row).toMatchObject({ servedModel: null, newestModel: SERVED_MODEL, modelCheck: 'not-reported' })
    }
  })
})
