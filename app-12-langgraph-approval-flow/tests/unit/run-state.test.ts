import { describe, expect, it } from 'vitest'
import type { StreamEvent } from '../../netlify/shared/events'
import { NOT_NEEDED_DETAIL } from '../../netlify/shared/events'
import { applyEvent, emptyRun, runFromView } from '../../src/lib/run-state'
import { formatCost, formatMs, formatTokens } from '../../src/lib/format'
import type { ThreadView } from '../../src/types'

function apply(events: StreamEvent[]) {
  return events.reduce((run, event) => applyEvent(run, event), emptyRun())
}

const proposal = {
  proposal: { action: 'refund' as const, amount: 129, rationale: 'Two charges.' },
  policy: { eligible: true, reason: 'r', amount: 129, requiresHuman: true },
  orderId: 'ORD-1042',
  orderTotal: 129,
  requestedAmount: 129,
}

describe('applyEvent', () => {
  it('moves a node from running to done and records its trace row', () => {
    const run = apply([
      { type: 'thread', threadId: 't-1' },
      { type: 'node_start', node: 'intake', ms: 3 },
      { type: 'node_end', node: 'intake', ms: 40, status: 'ok', model: 'mimo', usage: { total_tokens: 9 }, cost: 0.01, costSource: 'usage', detail: 'Read ORD-1077.' },
    ])
    expect(run.threadId).toBe('t-1')
    expect(run.nodes.intake).toBe('done')
    expect(run.trace).toEqual([
      { node: 'intake', status: 'ok', ms: 40, model: 'mimo', usage: { total_tokens: 9 }, cost: 0.01, costSource: 'usage', detail: 'Read ORD-1077.' },
    ])
  })

  it('records a labelled edge and pauses review with the proposal on an interrupt', () => {
    const run = apply([
      { type: 'edge', from: 'decide', to: 'review', label: 'requiresHuman' },
      { type: 'node_start', node: 'review', ms: 90 },
      { type: 'interrupt', node: 'review', threadId: 't-2', payload: proposal },
    ])
    expect(run.taken['decide>review']).toBe('requiresHuman')
    expect(run.nodes.review).toBe('waiting')
    expect(run.proposal).toEqual(proposal)
  })

  it('marks review skipped on an automatic refund and takes the otherwise edge', () => {
    const run = apply([
      { type: 'edge', from: 'decide', to: 'reply', label: 'otherwise' },
      { type: 'node_end', node: 'review', ms: 0, status: 'skipped', detail: NOT_NEEDED_DETAIL },
    ])
    expect(run.nodes.review).toBe('skipped')
    expect(run.taken['decide>reply']).toBe('otherwise')
  })

  it('keeps the error text and sets the finished result, replacing the trace with the complete one', () => {
    const result = {
      threadId: 't-3',
      action: 'refund' as const,
      amount: 24.5,
      proposal: { action: 'refund' as const, amount: 24.5, rationale: 'r' },
      humanDecision: null,
      reply: { subject: 'Your refund for ORD-1077', body: 'Dear customer.' },
      policy: { eligible: true, reason: 'r', amount: 24.5, requiresHuman: false },
      trace: [{ node: 'intake' as const, status: 'ok' as const, ms: 5, detail: 'd' }],
      totals: { nodeMs: 5, tokens: null, cost: null, costSource: null, models: [] },
    }
    const finished = apply([{ type: 'result', result }])
    expect(finished.result).toEqual(result)
    expect(finished.trace).toEqual(result.trace)
    expect(apply([{ type: 'error', message: 'stopped' }]).error).toBe('stopped')
  })
})

describe('runFromView', () => {
  const trace = (rows: Array<[ThreadView['trace'][number]['node'], ThreadView['trace'][number]['status']]>) =>
    rows.map(([node, status]) => ({ node, status, ms: 1, detail: 'd' }))

  it('rebuilds a waiting thread with review waiting and the requiresHuman edge taken', () => {
    const view: ThreadView = {
      threadId: 't-4',
      title: 'Duplicate charge',
      status: 'awaiting_approval',
      updatedAt: '2026-10-08T12:00:00.000Z',
      storage: 'blobs',
      proposal,
      trace: trace([
        ['intake', 'ok'],
        ['policy', 'ok'],
        ['decide', 'ok'],
        ['review', 'skipped'],
        ['reply', 'skipped'],
      ]),
      result: null,
    }
    const run = runFromView(view)
    expect(run.nodes.review).toBe('waiting')
    expect(run.nodes.reply).toBe('skipped')
    expect(run.taken).toMatchObject({ 'decide>review': 'requiresHuman' })
    expect(run.proposal).toEqual(proposal)
    expect(run.trace.map((row) => row.node)).toEqual(['intake', 'policy', 'decide'])
  })

  it('rebuilds a failed thread with its error text', () => {
    const view: ThreadView = {
      threadId: 't-5',
      title: 'Failed',
      status: 'failed',
      updatedAt: '2026-10-08T12:00:00.000Z',
      storage: 'memory',
      proposal: null,
      trace: trace([['intake', 'failed']]),
      result: null,
    }
    expect(runFromView(view).error).toContain('stopped before it finished')
  })
})

describe('formatting', () => {
  it('labels an estimated cost and reports a missing one', () => {
    expect(formatCost(0.00002, 'estimated')).toBe('$0.000020 (estimated)')
    expect(formatCost(0.00002, 'usage')).toBe('$0.000020')
    expect(formatCost(undefined, undefined)).toBe('not reported')
    expect(formatTokens(null)).toBe('not reported')
    expect(formatTokens(1234)).toBe('1,234')
    expect(formatMs(850)).toBe('850 ms')
    expect(formatMs(2500)).toBe('2.50 s')
  })
})
