import { describe, expect, it } from 'vitest'
import { NOT_NEEDED_DETAIL } from '../../netlify/shared/events'
import { buildResult, padTrace, threadViewOf } from '../../netlify/shared/thread-view'
import { totalsOf } from '../../src/lib/totals'
import type { GraphValues } from '../../netlify/shared/state'
import type { Decision, ThreadEntry, TraceRow } from '../../src/types'

const decision: Decision = { action: 'refund', amount: 129, rationale: 'Two charges.' }
const policy = { eligible: true, reason: 'r', amount: 129, requiresHuman: true }
const reply = { subject: 'Your refund for ORD-1042', body: 'Dear customer.' }

const intakeRow: TraceRow = { node: 'intake', status: 'ok', ms: 10, model: 'mimo', usage: { total_tokens: 100 }, cost: 0.00001, costSource: 'usage', detail: 'd' }
const decideRow: TraceRow = { node: 'decide', status: 'ok', ms: 20, model: 'haiku', usage: { total_tokens: 50 }, cost: 0.00002, costSource: 'estimated', detail: 'd' }

function values(overrides: Partial<GraphValues>): GraphValues {
  return {
    ticket: 'ticket',
    extracted: { orderId: 'ORD-1042', issue: 'duplicate_charge', requestedAmount: 129 },
    policyResult: policy,
    decision,
    humanDecision: null,
    replyEmail: null,
    status: 'running',
    trace: [intakeRow, decideRow],
    ...overrides,
  }
}

describe('padTrace', () => {
  it('lists every node in graph order, and marks the ones that have not run yet as pending on a waiting thread', () => {
    const rows = padTrace([intakeRow], 'awaiting_approval')
    expect(rows.map((row) => [row.node, row.status])).toEqual([
      ['intake', 'ok'],
      ['policy', 'pending'],
      ['decide', 'pending'],
      ['review', 'pending'],
      ['reply', 'pending'],
    ])
    expect(rows[3].detail).toBe('Waiting for a person.')
    expect(rows[4].detail).toBe('Not run yet.')
  })

  it('marks a node that never ran as skipped on a finished or failed thread, never as pending', () => {
    for (const status of ['completed', 'failed'] as const) {
      const rows = padTrace([intakeRow], status)
      expect(rows.map((row) => row.status)).toEqual(['ok', 'skipped', 'skipped', 'skipped', 'skipped'])
    }
  })

  it('keeps the rows that ran, whatever the thread status', () => {
    const rows = padTrace([intakeRow, decideRow], 'awaiting_approval')
    expect(rows[0]).toBe(intakeRow)
    expect(rows[2]).toBe(decideRow)
  })

  it('explains an automatic path and a failed thread in plain words', () => {
    expect(padTrace([], 'completed')[3].detail).toBe(NOT_NEEDED_DETAIL)
    expect(padTrace([], 'failed')[4].detail).toBe('Not run: an earlier step failed.')
  })
})

describe('totalsOf', () => {
  it('sums node time and tokens, and labels a cost estimated when any part was estimated', () => {
    const totals = totalsOf([intakeRow, decideRow])
    expect(totals).toMatchObject({ nodeMs: 30, tokens: 150, costSource: 'estimated', models: ['mimo', 'haiku'] })
    expect(totals.cost).toBeCloseTo(0.00003, 12)
  })

  it('reports no total for tokens or cost when a model call did not report them', () => {
    const partial = totalsOf([{ ...intakeRow, usage: undefined, cost: undefined, costSource: undefined }, decideRow])
    expect(partial.tokens).toBeNull()
    expect(partial.cost).toBeNull()
    expect(partial.costSource).toBeNull()
  })
})

describe('buildResult', () => {
  it('applies the human answer to the outcome, and keeps the proposal and the trace', () => {
    const result = buildResult(
      'thread-1',
      values({
        humanDecision: { action: 'edit', amount: 100, note: 'Partial refund agreed' },
        replyEmail: reply,
        trace: [intakeRow, decideRow, { node: 'review', status: 'ok', ms: 5, detail: 'Changed the refund to $100.00.' }, { node: 'reply', status: 'ok', ms: 7, detail: 'd' }],
      }),
    )
    expect(result).toMatchObject({
      threadId: 'thread-1',
      action: 'refund',
      amount: 100,
      proposal: decision,
      reply,
    })
    expect(result.trace.map((row) => row.node)).toEqual(['intake', 'policy', 'decide', 'review', 'reply'])
    expect(result.trace[1].status).toBe('skipped')
  })

  it('throws when a completed thread is missing its reply', () => {
    expect(() => buildResult('thread-2', values({ replyEmail: null }))).toThrow('The thread has no reply.')
  })
})

describe('threadViewOf', () => {
  const entry: ThreadEntry = {
    id: 'thread-3',
    title: 'Duplicate charge',
    status: 'awaiting_approval',
    updatedAt: '2026-10-08T12:00:00.000Z',
    amount: 129,
  }
  const proposal = { proposal: decision, policy, orderId: 'ORD-1042', orderTotal: 129, requestedAmount: 129 }

  it('shows the proposal and no result while a person is needed', () => {
    const view = threadViewOf({ threadId: 'thread-3', entry, storage: 'memory', values: values({}), proposal })
    expect(view).toMatchObject({ status: 'awaiting_approval', storage: 'memory', result: null })
    expect(view.proposal).toEqual(proposal)
    expect(view.trace.map((row) => row.status)).toEqual(['ok', 'pending', 'ok', 'pending', 'pending'])
  })

  it('returns the full ticket text, not the shortened title', () => {
    const long = 'I was charged twice for ORD-1042. '.repeat(10).trim()
    const view = threadViewOf({ threadId: 'thread-3', entry, storage: 'memory', values: values({ ticket: long }), proposal })
    expect(view.ticket).toBe(long)
    expect(view.title).toBe('Duplicate charge')
  })

  it('shows the result and no proposal once the thread is completed', () => {
    const view = threadViewOf({
      threadId: 'thread-3',
      entry: { ...entry, status: 'completed' },
      storage: 'blobs',
      values: values({ humanDecision: { action: 'approve' }, replyEmail: reply }),
      proposal: null,
    })
    expect(view.proposal).toBeNull()
    expect(view.result).toMatchObject({ action: 'refund', amount: 129, reply })
  })
})
