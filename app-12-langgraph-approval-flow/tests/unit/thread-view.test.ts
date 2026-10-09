import { describe, expect, it } from 'vitest'
import { NOT_NEEDED_DETAIL } from '../../netlify/shared/events'
import type { GraphValues } from '../../netlify/shared/state'
import { decideTriage } from '../../netlify/shared/triage'
import { buildResult, padTrace, threadViewOf } from '../../netlify/shared/thread-view'
import { totalsOf } from '../../src/lib/totals'
import type { ThreadEntry, TraceRow } from '../../src/types'
import { BUG, CLASSIFIED_BUG, CLASSIFIED_QUESTION, PROPOSAL, QUESTION } from '../helpers/issues'

const reply = { body: 'Thanks for the report.' }
const classifyRow: TraceRow = { node: 'classify', status: 'ok', ms: 10, model: 'mimo', usage: { total_tokens: 100 }, cost: 0.00001, costSource: 'usage', detail: 'd' }
const duplicatesRow: TraceRow = { node: 'duplicates', status: 'ok', ms: 15, detail: 'd' }
const decideRow: TraceRow = { node: 'decide', status: 'ok', ms: 20, detail: 'd' }
const replyRow: TraceRow = { node: 'reply', status: 'ok', ms: 30, model: 'haiku', usage: { total_tokens: 50 }, cost: 0.00002, costSource: 'estimated', detail: 'd' }

function values(overrides: Partial<GraphValues>): GraphValues {
  return {
    issue: BUG,
    classification: CLASSIFIED_BUG,
    triage: decideTriage(BUG, CLASSIFIED_BUG),
    humanDecision: null,
    replyDraft: null,
    status: 'running',
    trace: [classifyRow, duplicatesRow, decideRow],
    duplicateReport: null,
    ...overrides,
  }
}

describe('padTrace', () => {
  it('lists every node in graph order, and marks the ones that have not run yet as pending on a waiting thread', () => {
    const rows = padTrace([classifyRow, duplicatesRow, decideRow], 'awaiting_approval')
    expect(rows.map((row) => [row.node, row.status])).toEqual([
      ['classify', 'ok'],
      ['duplicates', 'ok'],
      ['decide', 'ok'],
      ['review', 'pending'],
      ['reply', 'pending'],
    ])
    expect(rows[3].detail).toBe('Waiting for a maintainer.')
    expect(rows[4].detail).toBe('Not run yet.')
  })

  it('marks a node that never ran as skipped on a finished or failed thread, never as pending', () => {
    for (const status of ['completed', 'failed'] as const) {
      expect(padTrace([classifyRow], status).map((row) => row.status)).toEqual(['ok', 'skipped', 'skipped', 'skipped', 'skipped'])
    }
  })

  it('keeps the rows that ran, whatever the thread status', () => {
    const rows = padTrace([classifyRow, duplicatesRow, decideRow], 'awaiting_approval')
    expect(rows[0]).toBe(classifyRow)
    expect(rows[2]).toBe(decideRow)
  })

  it('explains an automatic path and a failed thread in plain words', () => {
    expect(padTrace([], 'completed')[3].detail).toBe(NOT_NEEDED_DETAIL)
    expect(padTrace([], 'failed')[4].detail).toBe('Not run: an earlier step failed.')
  })
})

describe('totalsOf', () => {
  it('sums node time and tokens, and labels a cost estimated when any part was estimated', () => {
    const totals = totalsOf([classifyRow, decideRow, replyRow])
    expect(totals).toMatchObject({ nodeMs: 60, tokens: 150, costSource: 'estimated', models: ['mimo', 'haiku'] })
    expect(totals.cost).toBeCloseTo(0.00003, 12)
  })

  it('reports no total for tokens or cost when a model call did not report them', () => {
    const partial = totalsOf([{ ...classifyRow, usage: undefined, cost: undefined, costSource: undefined }, replyRow])
    expect(partial.tokens).toBeNull()
    expect(partial.cost).toBeNull()
    expect(partial.costSource).toBeNull()
  })
})

describe('buildResult', () => {
  it('applies the maintainer edit to the card, and keeps the proposal and the trace', () => {
    const result = buildResult(
      'thread-1',
      values({
        humanDecision: { action: 'edit', labels: ['bug', 'help wanted'], priority: 'medium', note: 'Only the legacy router' },
        replyDraft: reply,
        trace: [classifyRow, duplicatesRow, decideRow, { node: 'review', status: 'ok', ms: 5, detail: 'd' }, replyRow],
      }),
    )
    expect(result).toMatchObject({
      threadId: 'thread-1',
      issue: { repo: 'acme/widgets', number: 202 },
      outcome: 'edited',
      labels: ['bug', 'help wanted'],
      priority: 'medium',
      path: 'human',
      reply,
    })
    expect(result.triage).toMatchObject({ labels: ['bug', 'area: router'], priority: 'high' })
    expect(result.trace.map((row) => row.node)).toEqual(['classify', 'duplicates', 'decide', 'review', 'reply'])
  })

  it('reports the auto path with the proposal as the card, and review skipped', () => {
    const quiet = values({
      issue: QUESTION,
      classification: CLASSIFIED_QUESTION,
      triage: decideTriage(QUESTION, CLASSIFIED_QUESTION),
      replyDraft: reply,
      trace: [classifyRow, duplicatesRow, decideRow, replyRow],
    })
    const result = buildResult('thread-2', quiet)
    expect(result).toMatchObject({ outcome: 'auto', path: 'auto', labels: ['question', 'area: dev server'], priority: 'low', humanDecision: null })
    expect(result.trace[3]).toMatchObject({ node: 'review', status: 'skipped', detail: NOT_NEEDED_DETAIL })
  })

  it('applies nothing on a reject', () => {
    const result = buildResult('thread-3', values({ humanDecision: { action: 'reject' }, replyDraft: reply }))
    expect(result).toMatchObject({ outcome: 'rejected', labels: [], priority: null, path: 'human' })
  })

  it('throws when a completed thread is missing its reply', () => {
    expect(() => buildResult('thread-4', values({ replyDraft: null }))).toThrow('The thread has no reply.')
  })
})

describe('threadViewOf', () => {
  const entry: ThreadEntry = {
    id: 'thread-5',
    title: 'acme/widgets #202: Router crashes',
    repo: 'acme/widgets',
    number: 202,
    status: 'awaiting_approval',
    updatedAt: '2026-10-09T12:00:00.000Z',
    priority: 'high',
  }

  it('shows the proposal and no result while a maintainer is needed', () => {
    const view = threadViewOf({ threadId: 'thread-5', entry, storage: 'memory', values: values({}), proposal: PROPOSAL, retryable: false })
    expect(view).toMatchObject({ status: 'awaiting_approval', storage: 'memory', result: null })
    expect(view.proposal).toEqual(PROPOSAL)
    expect(view.trace.map((row) => row.status)).toEqual(['ok', 'ok', 'ok', 'pending', 'pending'])
  })

  it('passes the retryable flag of a failed thread through', () => {
    const view = threadViewOf({ threadId: 'thread-5', entry: { ...entry, status: 'failed' }, storage: 'memory', values: values({}), proposal: null, retryable: true })
    expect(view).toMatchObject({ status: 'failed', retryable: true, proposal: null, result: null })
  })

  it('returns the full issue, not the shortened title', () => {
    const view = threadViewOf({ threadId: 'thread-5', entry, storage: 'memory', values: values({}), proposal: PROPOSAL, retryable: false })
    expect(view.issue).toEqual(BUG)
    expect(view.title).toBe('acme/widgets #202: Router crashes')
  })

  it('shows the result and no proposal once the thread is completed', () => {
    const view = threadViewOf({
      threadId: 'thread-5',
      entry: { ...entry, status: 'completed' },
      storage: 'blobs',
      values: values({ humanDecision: { action: 'approve' }, replyDraft: reply }),
      proposal: null,
      retryable: false,
    })
    expect(view.proposal).toBeNull()
    expect(view.result).toMatchObject({ outcome: 'approved', labels: ['bug', 'area: router'], priority: 'high', reply })
  })

  it('throws, so the read answers 500 and not a half thread, when the checkpoint has no issue', () => {
    expect(() => threadViewOf({ threadId: 'thread-5', entry, storage: 'memory', values: values({ issue: null }), proposal: null, retryable: false })).toThrow(
      'The thread has no issue.',
    )
  })
})
