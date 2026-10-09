import { describe, expect, it } from 'vitest'
import type { StreamEvent } from '../../netlify/shared/events'
import { NOT_NEEDED_DETAIL } from '../../netlify/shared/events'
import { applyEvent, emptyRun, runFromView } from '../../src/lib/run-state'
import { padTrace } from '../../netlify/shared/thread-view'
import { formatAge, formatCost, formatMs, formatTokens } from '../../src/lib/format'
import type { RunResult, ThreadView } from '../../src/types'
import { BUG, CLASSIFIED_QUESTION, PROPOSAL, QUESTION } from '../helpers/issues'

function apply(events: StreamEvent[]) {
  return events.reduce((run, event) => applyEvent(run, event), emptyRun())
}

describe('applyEvent', () => {
  it('moves a node from running to done and records its trace row', () => {
    const run = apply([
      { type: 'thread', threadId: 't-1' },
      { type: 'node_start', node: 'classify', ms: 3 },
      { type: 'node_end', node: 'classify', ms: 40, status: 'ok', model: 'mimo', usage: { total_tokens: 9 }, cost: 0.01, costSource: 'usage', detail: 'Read as bug.' },
    ])
    expect(run.threadId).toBe('t-1')
    expect(run.nodes.classify).toBe('done')
    expect(run.trace).toEqual([
      { node: 'classify', status: 'ok', ms: 40, model: 'mimo', usage: { total_tokens: 9 }, cost: 0.01, costSource: 'usage', detail: 'Read as bug.' },
    ])
  })

  it('records a labelled edge and pauses review with the proposal on an interrupt', () => {
    const run = apply([
      { type: 'edge', from: 'decide', to: 'review', label: 'requiresHuman' },
      { type: 'node_start', node: 'review', ms: 90 },
      { type: 'interrupt', node: 'review', threadId: 't-2', payload: PROPOSAL },
    ])
    expect(run.taken['decide>review']).toBe('requiresHuman')
    expect(run.nodes.review).toBe('waiting')
    expect(run.proposal).toEqual(PROPOSAL)
  })

  it('marks review skipped on an automatic triage and takes the otherwise edge', () => {
    const run = apply([
      { type: 'edge', from: 'decide', to: 'reply', label: 'otherwise' },
      { type: 'node_end', node: 'review', ms: 0, status: 'skipped', detail: NOT_NEEDED_DETAIL },
    ])
    expect(run.nodes.review).toBe('skipped')
    expect(run.taken['decide>reply']).toBe('otherwise')
  })

  it('keeps the error text and sets the finished result, replacing the trace with the complete one', () => {
    const result: RunResult = {
      threadId: 't-3',
      issue: { repo: 'acme/widgets', number: 101, title: QUESTION.title, htmlUrl: QUESTION.htmlUrl },
      outcome: 'auto',
      labels: ['question'],
      priority: 'low',
      classification: CLASSIFIED_QUESTION,
      triage: { ...PROPOSAL.triage, requiresHuman: false, reasons: [], priority: 'low', labels: ['question'] },
      humanDecision: null,
      reply: { body: 'Thanks.' },
      path: 'auto',
      trace: [{ node: 'classify', status: 'ok', ms: 5, detail: 'd' }],
      totals: { nodeMs: 5, tokens: null, cost: null, costSource: null, models: [] },
    }
    const finished = apply([{ type: 'result', result }])
    expect(finished.result).toEqual(result)
    expect(finished.trace).toEqual(result.trace)
    expect(apply([{ type: 'error', message: 'stopped' }]).error).toBe('stopped')
  })

  it('marks a run retryable once it has a thread, and not before', () => {
    expect(apply([{ type: 'error', message: 'no thread yet' }]).retryable).toBe(false)
    const run = apply([{ type: 'thread', threadId: 't-8' }, { type: 'error', message: 'stopped' }])
    expect(run).toMatchObject({ error: 'stopped', retryable: true })
  })

  it('carries the issue the run was started for', () => {
    const issue = PROPOSAL.issue
    expect(emptyRun(issue).issue).toEqual(issue)
    expect(applyEvent(emptyRun(issue), { type: 'thread', threadId: 't-9' }).issue).toEqual(issue)
  })
})

describe('runFromView', () => {
  const trace = (rows: Array<[ThreadView['trace'][number]['node'], ThreadView['trace'][number]['status']]>) =>
    rows.map(([node, status]) => ({ node, status, ms: 1, detail: 'd' }))
  const base = {
    title: 'acme/widgets #202: Router crashes',
    issue: BUG,
    updatedAt: '2026-10-09T12:00:00.000Z',
    storage: 'blobs' as const,
  }

  it('rebuilds a waiting thread with review waiting and the requiresHuman edge taken', () => {
    const view: ThreadView = {
      ...base,
      threadId: 't-4',
      status: 'awaiting_approval',
      proposal: PROPOSAL,
      retryable: false,
      trace: trace([['classify', 'ok'], ['decide', 'ok'], ['review', 'pending'], ['reply', 'pending']]),
      result: null,
    }
    const run = runFromView(view)
    expect(run.nodes).toEqual({ classify: 'done', decide: 'done', review: 'waiting', reply: 'idle' })
    expect(run.taken).toEqual({ 'classify>decide': '', 'decide>review': 'requiresHuman' })
    expect(run.proposal).toEqual(PROPOSAL)
    expect(run.issue).toEqual(PROPOSAL.issue)
    expect(run.trace.map((row) => row.node)).toEqual(['classify', 'decide'])
  })

  it('shows a reloaded waiting thread exactly like the live paused run', () => {
    const live = apply([
      { type: 'thread', threadId: 't-6' },
      { type: 'node_end', node: 'classify', ms: 1, status: 'ok', detail: 'd' },
      { type: 'edge', from: 'classify', to: 'decide' },
      { type: 'node_end', node: 'decide', ms: 1, status: 'ok', detail: 'd' },
      { type: 'edge', from: 'decide', to: 'review', label: 'requiresHuman' },
      { type: 'node_start', node: 'review', ms: 1 },
      { type: 'interrupt', node: 'review', threadId: 't-6', payload: PROPOSAL },
    ])
    const reloaded = runFromView({
      ...base,
      threadId: 't-6',
      status: 'awaiting_approval',
      proposal: PROPOSAL,
      retryable: false,
      trace: padTrace(live.trace, 'awaiting_approval'),
      result: null,
    })
    expect(reloaded.nodes).toEqual(live.nodes)
    expect(reloaded.taken).toEqual(live.taken)
    expect(reloaded.trace.map((row) => row.node)).toEqual(['classify', 'decide'])
  })

  it('keeps review skipped and takes the otherwise edge on a finished automatic path', () => {
    const view: ThreadView = {
      ...base,
      threadId: 't-7',
      status: 'completed',
      proposal: null,
      retryable: false,
      trace: trace([['classify', 'ok'], ['decide', 'ok'], ['review', 'skipped'], ['reply', 'ok']]),
      result: null,
    }
    const run = runFromView(view)
    expect(run.nodes.review).toBe('skipped')
    expect(run.taken['decide>reply']).toBe('otherwise')
    expect('decide>review' in run.taken).toBe(false)
  })

  it('rebuilds a failed thread with its error text', () => {
    const view: ThreadView = {
      ...base,
      threadId: 't-5',
      status: 'failed',
      storage: 'memory',
      proposal: null,
      retryable: false,
      trace: trace([['classify', 'failed']]),
      result: null,
    }
    expect(runFromView(view).error).toContain('stopped before it finished')
    expect(runFromView(view).retryable).toBe(false)
    expect(runFromView({ ...view, retryable: true }).retryable).toBe(true)
    // A thread that is not failed is never retryable, whatever the server says.
    expect(runFromView({ ...view, status: 'completed', retryable: true }).retryable).toBe(false)
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

  it('says how old an issue is in the largest whole unit', () => {
    const now = Date.parse('2026-10-09T12:00:00Z')
    expect(formatAge('2026-10-09T11:59:40Z', now)).toBe('just now')
    expect(formatAge('2026-10-09T11:55:00Z', now)).toBe('5 min ago')
    expect(formatAge('2026-10-09T09:00:00Z', now)).toBe('3 h ago')
    expect(formatAge('2026-10-08T12:00:00Z', now)).toBe('1 day ago')
    expect(formatAge('2026-10-02T12:00:00Z', now)).toBe('7 days ago')
    expect(formatAge('2026-07-09T12:00:00Z', now)).toBe('3 months ago')
    expect(formatAge('2023-10-09T12:00:00Z', now)).toBe('3 years ago')
    expect(formatAge('not a date', now)).toBe('unknown age')
  })
})
