import { describe, expect, it } from 'vitest'
import { Command, type StateSnapshot } from '@langchain/langgraph'
import { buildGraph } from '../../netlify/shared/graph'
import { GraphGateSaver } from '../../netlify/shared/blobs-saver'
import { DECIDE_MODEL, INTAKE_MODEL, REPLY_MODEL } from '../../netlify/shared/models'
import { createMemoryStore } from '../../netlify/shared/store'
import type { TraceRow } from '../../src/types'
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
    expect(lastUserPrompt(chat, REPLY_MODEL)).toContain('Outcome: no refund')
    expect(lastUserPrompt(chat, REPLY_MODEL)).toContain('Reviewer note: Bank shows one settled charge')
    expect(values.replyEmail?.subject).toBe('Update on ORD-1042')
  })

  it('edits the amount and the reply quotes the edited amount', async () => {
    const chat = fakeChat()
    const { graph } = setup(chat)
    const threadId = 'graph-edit-1'
    await start(graph, threadId, LARGE_TICKET)

    await resume(graph, threadId, { action: 'edit', amount: 100 })

    expect(lastUserPrompt(chat, REPLY_MODEL)).toContain('Outcome: refund of $100.00')
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
