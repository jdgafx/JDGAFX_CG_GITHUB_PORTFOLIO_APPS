import { describe, expect, it, vi } from 'vitest'
import { GraphGateSaver } from '../../netlify/shared/blobs-saver'
import { CLASSIFY_PROMPT } from '../../netlify/shared/classify'
import { JUDGE_PROMPT } from '../../netlify/shared/duplicate-judge'
import { mergeFound } from '../../netlify/shared/duplicate-rank'
import type { StreamEvent } from '../../netlify/shared/events'
import { parseSearch, type SearchFn } from '../../netlify/shared/github-search'
import { buildGraph } from '../../netlify/shared/graph'
import { REPLY_PROMPT } from '../../netlify/shared/nodes'
import { startRun, type RunDeps } from '../../netlify/shared/run'
import { createMemoryStore } from '../../netlify/shared/store'
import type { DuplicateReport } from '../../src/types'
import { fakeChat } from '../helpers/fake-chat'
import { QUESTION, issue } from '../helpers/issues'
import recorded from '../fixtures/vscode-334721.json'

const NOW = new Date('2026-10-12T12:00:00Z')
const CUT_OFF = 'The AI ran out of reply length before the reply was finished.'

/** The fake chat, except that the call with this system prompt stops at the token cap while its text is still whole. */
function cutAt(prompt: string, options: Parameters<typeof fakeChat>[0] = {}) {
  const chat = fakeChat(options)
  const base = chat.getMockImplementation()!
  chat.mockImplementation(async (request, signal) => {
    const result = await base(request, signal)
    return request.messages[0].content.startsWith(prompt) ? { ...result, finishReason: 'length' } : result
  })
  return chat
}

async function started(chat: ReturnType<typeof fakeChat>) {
  const store = createMemoryStore()
  const deps: RunDeps = { store, storage: 'memory', chat, now: () => NOW }
  const events: StreamEvent[] = []
  await startRun(deps, { issue: QUESTION, threadId: 'cut-off', budget: new AbortController().signal, send: (event) => events.push(event) })
  return events
}

const saved = 'Finished steps are saved, so you can retry the thread.'

describe('a reply cut off at the token cap is never used', () => {
  it('ends the run at classify when the classification is cut off but still parses, and calls no later step', async () => {
    const chat = cutAt(CLASSIFY_PROMPT)
    const events = await started(chat)
    expect(events.find((event) => event.type === 'error')).toEqual({
      type: 'error',
      message: `The AI ran out of reply length during the classify step before the reply was finished. ${saved}`,
    })
    expect(events.find((event) => event.type === 'node_end')).toMatchObject({ node: 'classify', status: 'failed' })
    expect(events.some((event) => event.type === 'result')).toBe(false)
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('ends the run at reply when the draft is cut off, and never shows it as a draft', async () => {
    const chat = cutAt(REPLY_PROMPT, { email: 'Thanks for the report. We have triaged this issue.' })
    const events = await started(chat)
    expect(events.find((event) => event.type === 'error')).toEqual({
      type: 'error',
      message: `The AI ran out of reply length during the reply step before the reply was finished. ${saved}`,
    })
    expect(events.some((event) => event.type === 'result')).toBe(false)
    expect(JSON.stringify(events)).not.toContain('Thanks for the report. We have triaged this issue.')
  })

  it('makes one call only: a cut-off reply is not retried', async () => {
    const chat = cutAt(CLASSIFY_PROMPT)
    await started(chat)
    expect(chat.mock.calls.filter(([request]) => request.messages[0].content.startsWith(CLASSIFY_PROMPT))).toHaveLength(1)
  })

  it('still uses a reply that ends normally or names no finish reason', async () => {
    const chat = fakeChat()
    const base = chat.getMockImplementation()!
    chat.mockImplementation(async (request, signal) => ({ ...(await base(request, signal)), finishReason: null }))
    const events = await started(chat)
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events.some((event) => event.type === 'result')).toBe(true)
  })

  describe('the duplicate judge', () => {
    const target = issue({
      repo: 'microsoft/vscode',
      number: 334721,
      title: recorded.issue.title,
      body: recorded.issue.body,
      htmlUrl: 'https://github.com/microsoft/vscode/issues/334721',
    })
    const found = mergeFound(parseSearch(recorded.strict), parseSearch(recorded.broad))
    const search: SearchFn = vi.fn(async () => found)
    const Q = 'The compact hamburger menu should open and show File, Edit, Selection, View'
    const whole = JSON.stringify({
      verdicts: [
        { number: 334403, verdict: 'duplicate', reason: 'Same menu, same version, same failure.', issueQuote: Q, candidateQuote: 'The menu (File / Edit / Selection / View / …) opens.' },
      ],
    })

    it('shows the candidates without verdicts when the verdicts are cut off but still parse, and proposes no duplicate', async () => {
      const chat = cutAt(JUDGE_PROMPT, { classification: { type: 'bug', area: 'menubar', severity: 'low', confidence: 0.9, summary: 'The compact menu does not open.' }, judge: whole })
      const graph = buildGraph({ chat, search, now: () => NOW, remainingMs: () => 25_000, checkpointer: new GraphGateSaver(createMemoryStore()) })
      const config = { configurable: { thread_id: 't-cut' } }
      const first = (await graph.invoke({ issue: target }, config)) as { __interrupt__?: unknown }
      const state = (await graph.getState(config)).values
      const report = state.duplicateReport as DuplicateReport
      expect(report.status).toBe('unavailable')
      expect(report.message).toContain(CUT_OFF)
      expect(report.confirmed).toBeNull()
      expect(report.candidates.length).toBeGreaterThan(0)
      expect(report.candidates.every((candidate) => candidate.judgement === null)).toBe(true)
      expect(state.trace[1]).toMatchObject({ node: 'duplicates', status: 'failed' })
      expect(first.__interrupt__).toBeUndefined()
    })
  })
})
