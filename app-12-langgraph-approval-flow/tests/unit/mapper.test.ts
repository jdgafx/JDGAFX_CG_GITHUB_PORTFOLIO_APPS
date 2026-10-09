import { describe, expect, it } from 'vitest'
import { DONE_FRAME, NOT_NEEDED_DETAIL, encodeFrame, SSE_HEADERS, type StreamEvent } from '../../netlify/shared/events'
import { FrameMapper } from '../../netlify/shared/mapper'
import { PROPOSAL } from '../helpers/issues'

function recorder() {
  const events: StreamEvent[] = []
  return { events, send: (event: StreamEvent) => events.push(event) }
}

const decideChunk = (requiresHuman: boolean) => ({
  triage: { requiresHuman, reasons: [], reason: 'reason', labels: [], priority: 'low' },
  trace: [{ node: 'decide', status: 'ok', ms: 2, detail: 'reason' }],
})

describe('encodeFrame and the stream constants', () => {
  it('writes one data line per event, followed by a blank line', () => {
    const frame = encodeFrame({ type: 'thread', threadId: 'abc' })
    expect(frame).toBe('data: {"type":"thread","threadId":"abc"}\n\n')
    expect(JSON.parse(frame.slice(6).trim())).toEqual({ type: 'thread', threadId: 'abc' })
  })

  it('ends the stream with [DONE] and declares an event stream', () => {
    expect(DONE_FRAME).toBe('data: [DONE]\n\n')
    expect(SSE_HEADERS['Content-Type']).toBe('text/event-stream; charset=utf-8')
  })
})

describe('FrameMapper', () => {
  it('announces a node start, then sends its finished trace row and the edge that follows', () => {
    const { events, send } = recorder()
    const mapper = new FrameMapper('t-1', send, 0)

    mapper.onCustom({ type: 'node_start', node: 'classify' })
    mapper.onUpdates({
      classify: {
        trace: [{ node: 'classify', status: 'ok', ms: 12, model: 'm', usage: { total_tokens: 5 }, cost: 0.1, costSource: 'usage', detail: 'd' }],
      },
    })

    expect(events[0]).toMatchObject({ type: 'node_start', node: 'classify' })
    expect(events[1]).toEqual({
      type: 'node_end',
      node: 'classify',
      ms: 12,
      status: 'ok',
      model: 'm',
      usage: { total_tokens: 5 },
      cost: 0.1,
      costSource: 'usage',
      detail: 'd',
    })
    expect(events[2]).toEqual({ type: 'edge', from: 'classify', to: 'decide' })
  })

  it('takes the requiresHuman edge to review, and the interrupt frame carries the proposal', () => {
    const { events, send } = recorder()
    const mapper = new FrameMapper('t-2', send, 0)
    mapper.onUpdates({ decide: decideChunk(true) })
    mapper.onUpdates({ __interrupt__: [{ value: PROPOSAL, resumable: true }] })

    expect(events.filter((event) => event.type === 'edge')).toEqual([
      { type: 'edge', from: 'decide', to: 'review', label: 'requiresHuman' },
    ])
    expect(mapper.paused).toBe(true)
    expect(mapper.proposalPriority).toBe('high')
    expect(events[events.length - 1]).toEqual({ type: 'interrupt', node: 'review', threadId: 't-2', payload: PROPOSAL })
  })

  it('takes the otherwise edge to reply and reports review as skipped on an automatic triage', () => {
    const { events, send } = recorder()
    const mapper = new FrameMapper('t-3', send, 0)
    mapper.onUpdates({ decide: decideChunk(false) })

    expect(events).toContainEqual({ type: 'edge', from: 'decide', to: 'reply', label: 'otherwise' })
    expect(events).toContainEqual({ type: 'node_end', node: 'review', ms: 0, status: 'skipped', detail: NOT_NEEDED_DETAIL })
    expect(mapper.paused).toBe(false)
  })

  it('does not pause on an interrupt payload that is not a review payload', () => {
    const { events, send } = recorder()
    const mapper = new FrameMapper('t-6', send, 0)
    mapper.onUpdates({ __interrupt__: [{ value: { triage: { priority: 'p0' } } }] })
    mapper.onUpdates({ __interrupt__: [{ value: { ...PROPOSAL, triage: { ...PROPOSAL.triage, priority: 'p0' } } }] })
    mapper.onUpdates({ __interrupt__: 'nope' })
    expect(mapper.paused).toBe(false)
    expect(events).toEqual([])
  })

  it('marks the running node failed with the message when the run stops', () => {
    const { events, send } = recorder()
    const mapper = new FrameMapper('t-4', send, Date.now())
    mapper.onCustom({ type: 'node_start', node: 'reply' })
    mapper.failCurrent('The AI provider did not answer in time.')

    expect(events[events.length - 1]).toMatchObject({
      type: 'node_end',
      node: 'reply',
      status: 'failed',
      detail: 'The AI provider did not answer in time.',
    })
  })

  it('ignores custom chunks and updates it does not recognise', () => {
    const { events, send } = recorder()
    const mapper = new FrameMapper('t-5', send, 0)
    mapper.onCustom({ type: 'something-else', node: 'classify' })
    mapper.onCustom({ type: 'node_start', node: 'intake' })
    mapper.onUpdates({ notANode: { trace: [] } })
    expect(events).toEqual([])
  })
})
