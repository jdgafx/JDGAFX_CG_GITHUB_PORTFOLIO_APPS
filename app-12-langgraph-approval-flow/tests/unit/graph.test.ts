import { describe, expect, it } from 'vitest'
import { Command, type StateSnapshot } from '@langchain/langgraph'
import { buildGraph } from '../../netlify/shared/graph'
import { GraphGateSaver } from '../../netlify/shared/blobs-saver'
import { DECIDE_MODEL, INTAKE_MODEL, REPLY_MODEL } from '../../netlify/shared/models'
import { requestBody } from '../../netlify/shared/openrouter'
import { createMemoryStore } from '../../netlify/shared/store'
import type { TraceRow } from '../../src/types'
import { REPLY_PROMPT } from '../../netlify/shared/nodes'
import { fakeChat } from '../helpers/fake-chat'

const NOW = new Date('2026-10-08T12:00:00Z')
const SMALL_TICKET = 'Order ORD-1077 arrived with a dead wheel on the mouse, please refund that item.'
const LARGE_TICKET = 'I was charged twice for ORD-1042. Both charges were $129.00, please refund the extra one.'

interface Collected {
  nodes: string[]
  starts: string[]
  interrupts: unknown[]
}

/** Reads every chunk of one stream, sorting node updates, interrupts and the custom node_start markers. */
async function collect(stream: AsyncIterable<unknown>): Promise<Collected> {
  const collected: Collected = { nodes: [], starts: [], interrupts: [] }
  for await (const [mode, chunk] of stream as AsyncIterable<[string, Record<string, unknown>]>) {
    if (mode === 'custom') {
      const marker = chunk as { type?: string; node?: string }
      if (marker.type === 'node_start' && marker.node) collected.starts.push(marker.node)
      continue
    }
    for (const key of Object.keys(chunk)) {
      if (key === '__interrupt__') collected.interrupts.push(chunk[key])
      else collected.nodes.push(key)
    }
  }
  return collected
}

function setup(chat: ReturnType<typeof fakeChat>) {
  const saver = new GraphGateSaver(createMemoryStore())
  const graph = buildGraph({ chat, now: () => NOW, checkpointer: saver })
  return { graph, saver }
}

const MODES = ['updates', 'custom'] as const

async function start(graph: ReturnType<typeof setup>['graph'], threadId: string, ticket: string): Promise<Collected> {
  return collect(
    await graph.stream({ ticket }, { streamMode: [...MODES], configurable: { thread_id: threadId } }),
  )
}

async function resume(
  graph: ReturnType<typeof setup>['graph'],
  threadId: string,
  answer: { action: 'approve' | 'edit' | 'reject'; amount?: number; note?: string },
): Promise<Collected> {
  return collect(
    await graph.stream(new Command({ resume: answer }), {
      streamMode: [...MODES],
      configurable: { thread_id: threadId },
    }),
  )
}

function lastUserPrompt(chat: ReturnType<typeof fakeChat>, model: string): string {
  const calls = chat.mock.calls.filter(([request]) => request.model === model)
  const [request] = calls[calls.length - 1] ?? []
  return request?.messages.find((message) => message.role === 'user')?.content ?? ''
}

describe('graph: small refund path', () => {
  it('auto-approves a $24.50 defective item without a pause', async () => {
    const chat = fakeChat()
    const { graph } = setup(chat)
    const threadId = 'graph-small-1'

    const run = await start(graph, threadId, SMALL_TICKET)

    expect(run.nodes).toEqual(['intake', 'policy', 'decide', 'reply'])
    expect(run.starts).toEqual(['intake', 'policy', 'decide', 'reply'])
    expect(run.interrupts).toEqual([])
    const values = (await graph.getState({ configurable: { thread_id: threadId } })).values
    expect(values.decision).toEqual({ action: 'refund', amount: 24.5, rationale: 'Rationale from the fake model.' })
    expect(values.humanDecision).toBeNull()
    expect(values.replyEmail).toEqual({ subject: 'Your refund for ORD-1077', body: 'Dear customer, here is our reply.' })
    expect(values.status).toBe('completed')
    expect(values.trace.map((row: TraceRow) => [row.node, row.status])).toEqual([
      ['intake', 'ok'],
      ['policy', 'ok'],
      ['decide', 'ok'],
      ['reply', 'ok'],
    ])
  })

  it('calls the three model ids with the expected roles and reports served usage', async () => {
    const chat = fakeChat()
    const { graph } = setup(chat)

    await start(graph, 'graph-small-2', SMALL_TICKET)

    expect(chat.mock.calls.map(([request]) => request.model)).toEqual([INTAKE_MODEL, DECIDE_MODEL, REPLY_MODEL])
    expect(chat.mock.calls[0][0]).toMatchObject({ maxTokens: 300, json: true, requireParameters: false })
    expect(chat.mock.calls[1][0]).toMatchObject({ maxTokens: 500, json: true })
    expect(chat.mock.calls[2][0]).toMatchObject({ maxTokens: 600 })
    const { values } = await graph.getState({ configurable: { thread_id: 'graph-small-2' } })
    const intake = values.trace.find((row: TraceRow) => row.node === 'intake')
    expect(intake).toMatchObject({ model: INTAKE_MODEL, usage: { total_tokens: 120 } })
  })

  it('sends no temperature on the decide and reply calls, so the current Haiku is not rejected', async () => {
    const chat = fakeChat()
    const { graph } = setup(chat)

    await start(graph, 'graph-small-3', SMALL_TICKET)

    const [intake, decide, reply] = chat.mock.calls.map(([request]) => request)
    expect(intake).toMatchObject({ temperature: 0, json: true })
    expect(decide).not.toHaveProperty('temperature')
    expect(reply).not.toHaveProperty('temperature')
    // The wire body: provider routing is on for decide and reply, and neither carries a temperature.
    for (const request of [decide, reply]) {
      const body = requestBody(request)
      expect(body).not.toHaveProperty('temperature')
      expect(body).toMatchObject({ provider: { require_parameters: true } })
    }
    expect(requestBody(intake)).toMatchObject({ temperature: 0 })
    expect(requestBody(intake)).not.toHaveProperty('provider')
  })
})

describe('graph: large refund pauses for a human', () => {
  it('pauses at review with the checkpoint saved, then resumes on the same thread', async () => {
    const chat = fakeChat()
    const { graph, saver } = setup(chat)
    const threadId = 'graph-large-1'

    const first = await start(graph, threadId, LARGE_TICKET)

    expect(first.nodes).toEqual(['intake', 'policy', 'decide'])
    expect(first.interrupts).toHaveLength(1)
    const payload = (first.interrupts[0] as Array<{ value: unknown }>)[0].value
    expect(payload).toMatchObject({
      proposal: { action: 'refund', amount: 129 },
      policy: { eligible: true, amount: 129, requiresHuman: true },
      orderId: 'ORD-1042',
      orderTotal: 129,
      requestedAmount: 129,
    })

    const saved = await saver.getTuple({ configurable: { thread_id: threadId } })
    expect(saved?.pendingWrites?.map(([, channel]) => channel)).toContain('__interrupt__')
    const paused: StateSnapshot = await graph.getState({ configurable: { thread_id: threadId } })
    expect(paused.next).toEqual(['review'])

    const second = await resume(graph, threadId, { action: 'approve' })

    expect(second.nodes).toEqual(['review', 'reply'])
    expect(second.interrupts).toEqual([])
    const values = (await graph.getState({ configurable: { thread_id: threadId } })).values
    expect(values.humanDecision).toEqual({ action: 'approve' })
    expect(values.decision).toMatchObject({ action: 'refund', amount: 129 })
    expect(values.replyEmail?.subject).toBe('Your refund for ORD-1042')
    expect(values.trace.map((row: TraceRow) => row.node)).toEqual(['intake', 'policy', 'decide', 'review', 'reply'])
    expect(values.status).toBe('completed')
  })

  it('rejects with a polite denial that the reply model is asked to write', async () => {
    const chat = fakeChat()
    const { graph } = setup(chat)
    const threadId = 'graph-reject-1'
    await start(graph, threadId, LARGE_TICKET)

    const second = await resume(graph, threadId, { action: 'reject', note: 'Bank shows one settled charge' })

    expect(second.nodes).toEqual(['review', 'reply'])
    const values = (await graph.getState({ configurable: { thread_id: threadId } })).values
    expect(values.humanDecision).toEqual({ action: 'reject', note: 'Bank shows one settled charge' })
    expect(lastUserPrompt(chat, REPLY_MODEL)).toContain('a support reviewer rejected the refund. No refund will be given.')
    expect(lastUserPrompt(chat, REPLY_MODEL)).toContain('Reviewer note: Bank shows one settled charge')
    expect(values.replyEmail?.subject).toBe('Update on ORD-1042')
  })

  it('edits the amount and the reply quotes the edited amount', async () => {
    const chat = fakeChat()
    const { graph } = setup(chat)
    const threadId = 'graph-edit-1'
    await start(graph, threadId, LARGE_TICKET)

    await resume(graph, threadId, { action: 'edit', amount: 100 })

    expect(lastUserPrompt(chat, REPLY_MODEL)).toContain('a support reviewer approved a refund of $100.00 after changing the amount.')
    const values = (await graph.getState({ configurable: { thread_id: threadId } })).values
    expect(values.humanDecision).toEqual({ action: 'edit', amount: 100 })
    expect(values.decision).toMatchObject({ action: 'refund', amount: 129 })
  })

  it('pauses for a person when the order id matches no order, and the proposal is a denial', async () => {
    const chat = fakeChat({
      extraction: () => JSON.stringify({ orderId: 'ORD-9999', issue: 'defective_item', requestedAmount: null }),
    })
    const { graph } = setup(chat)
    const threadId = 'graph-unknown-1'

    const first = await start(graph, threadId, 'Order ORD-9999 never arrived, please refund it all.')

    expect(first.nodes).toEqual(['intake', 'policy', 'decide'])
    const payload = (first.interrupts[0] as Array<{ value: unknown }>)[0].value
    expect(payload).toMatchObject({
      proposal: { action: 'deny', amount: 0 },
      policy: { eligible: false, requiresHuman: true, reason: 'No order matches ORD-9999, so a person must check it.' },
      orderTotal: null,
    })
  })

  it('pauses for a person when the intake reply cannot be read', async () => {
    const chat = fakeChat({ extraction: () => 'not json at all' })
    const { graph } = setup(chat)
    const threadId = 'graph-unreadable-1'

    const first = await start(graph, threadId, SMALL_TICKET)

    expect(first.nodes).toEqual(['intake', 'policy', 'decide'])
    const values = (await graph.getState({ configurable: { thread_id: threadId } })).values
    expect(values.trace[0]).toMatchObject({ node: 'intake', status: 'failed' })
    expect(values.policyResult).toMatchObject({ eligible: false, requiresHuman: true })
  })
})

const STALE = 'This refund requires human approval before it can be processed.'
const CONTRADICTION =
  'Your refund requires approval from a member of our team before it can be processed. We will follow up once that approval is complete.'

describe('graph: the reply states a final outcome', () => {
  it('after a person edited the amount, sends the final-decision line and no stale rationale or policy reason', async () => {
    const chat = fakeChat({ rationale: STALE })
    const { graph } = setup(chat)
    await start(graph, 'reply-human-1', LARGE_TICKET)
    await resume(graph, 'reply-human-1', { action: 'edit', amount: 100, note: 'Agreed by phone' })

    const prompt = lastUserPrompt(chat, REPLY_MODEL)
    expect(prompt).toContain('Final outcome (already decided, nothing is pending): a support reviewer approved a refund of $100.00 after changing the amount.')
    expect(prompt).toContain('Reviewer note: Agreed by phone')
    expect(prompt).not.toContain(STALE)
    expect(prompt).not.toContain('Reason:')
    expect(prompt).not.toContain('so a person must approve it')
    expect(prompt).not.toContain('Decided automatically')
  })

  it('after a person approved or rejected, says so in the final-decision line', async () => {
    const approve = fakeChat({ rationale: STALE })
    const first = setup(approve)
    await start(first.graph, 'reply-human-2', LARGE_TICKET)
    await resume(first.graph, 'reply-human-2', { action: 'approve' })
    expect(lastUserPrompt(approve, REPLY_MODEL)).toContain('a support reviewer approved a refund of $129.00.')

    const reject = fakeChat({ rationale: STALE })
    const second = setup(reject)
    await start(second.graph, 'reply-human-3', LARGE_TICKET)
    await resume(second.graph, 'reply-human-3', { action: 'reject' })
    expect(lastUserPrompt(reject, REPLY_MODEL)).toContain('a support reviewer rejected the refund')
    expect(lastUserPrompt(reject, REPLY_MODEL)).not.toContain(STALE)
  })

  it('on the policy path, says it was decided automatically and nothing is pending', async () => {
    const chat = fakeChat({ rationale: 'Within the automatic limit.' })
    const { graph } = setup(chat)
    await start(graph, 'reply-policy-1', SMALL_TICKET)

    const prompt = lastUserPrompt(chat, REPLY_MODEL)
    expect(prompt).toContain('Final outcome (already decided, nothing is pending): refund of $24.50.')
    expect(prompt).toContain('Reason: Within the automatic limit.')
    expect(prompt).toContain('Decided automatically by the refund policy. Nothing is pending.')
  })

  it('tells the model that the outcome is final and nothing is pending', () => {
    expect(REPLY_PROMPT).toContain('The outcome you are given is final and already decided.')
    expect(REPLY_PROMPT).toContain('Never say that approval, review or a follow-up is still needed or pending')
  })

  it('replaces a reply that calls the decision pending with the standard wording, and says so in the trace', async () => {
    const chat = fakeChat({ email: CONTRADICTION })
    const { graph } = setup(chat)
    await start(graph, 'reply-guard-1', LARGE_TICKET)
    await resume(graph, 'reply-guard-1', { action: 'edit', amount: 100 })

    const values = (await graph.getState({ configurable: { thread_id: 'reply-guard-1' } })).values
    expect(values.replyEmail?.body).toBe('We have approved a refund of $100.00.')
    const row = values.trace.find((entry: TraceRow) => entry.node === 'reply')
    expect(row).toMatchObject({ status: 'ok' })
    expect(row?.detail).toContain('standard wording')
  })

  it('keeps a clean reply, including one that says a team member approved the refund', async () => {
    const clean = 'Good news: a member of our team approved a refund of $100.00. It will reach your card in a few days.'
    const chat = fakeChat({ email: clean })
    const { graph } = setup(chat)
    await start(graph, 'reply-guard-2', LARGE_TICKET)
    await resume(graph, 'reply-guard-2', { action: 'edit', amount: 100 })

    const values = (await graph.getState({ configurable: { thread_id: 'reply-guard-2' } })).values
    expect(values.replyEmail?.body).toBe(clean)
  })
})

