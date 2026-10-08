import { describe, expect, it } from 'vitest'
import { DONE_FRAME, NOT_NEEDED_DETAIL, encodeFrame, SSE_HEADERS, type StreamEvent } from '../../netlify/shared/events'
import { FrameMapper } from '../../netlify/shared/mapper'

function recorder() {
  const events: StreamEvent[] = []
  return { events, send: (event: StreamEvent) => events.push(event) }
}

const policyChunk = (requiresHuman: boolean) => ({
  policyResult: {
    eligible: true,
    reason: 'reason',
    amount: 24.5,
    requiresHuman,
  },
  trace: [{ node: 'policy', status: 'ok', ms: 2, detail: 'reason' }],
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

    mapper.onCustom({ type: 'node_start', node: 'intake' })
    mapper.onUpdates({
      intake: {
        trace: [{ node: 'intake', status: 'ok', ms: 12, model: 'm', usage: { total_tokens: 5 }, cost: 0.1, costSource: 'usage', detail: 'd' }],
      },
    })

    expect(events[0]).toMatchObject({ type: 'node_start', node: 'intake' })
    expect(events[1]).toEqual({
      type: 'node_end',
      node: 'intake',
      ms: 12,
      status: 'ok',
      model: 'm',
      usage: { total_tokens: 5 },
      cost: 0.1,
      costSource: 'usage',
      detail: 'd',
    })
    expect(events[2]).toEqual({ type: 'edge', from: 'intake', to: 'policy' })
  })

  it('takes the requiresHuman edge to review, and the interrupt frame carries the proposal', () => {
    const { events, send } = recorder()
    const mapper = new FrameMapper('t-2', send, 0)
    mapper.onUpdates({ policy: policyChunk(true) })
    expect(events).toContainEqual({ type: 'edge', from: 'policy', to: 'decide' })
    mapper.onUpdates({ decide: { trace: [{ node: 'decide', status: 'ok', ms: 3, detail: 'd' }] } })
    mapper.onUpdates({
      __interrupt__: [
        {
          value: {
            proposal: { action: 'refund', amount: 129, rationale: 'Two charges.' },
            policy: { eligible: true, reason: 'r', amount: 129, requiresHuman: true },
            orderId: 'ORD-1042',
            orderTotal: 129,
            requestedAmount: 129,
          },
          resumable: true,
        },
      ],
    })

    expect(events.filter((event) => event.type === 'edge')).toEqual([
      { type: 'edge', from: 'policy', to: 'decide' },
      { type: 'edge', from: 'decide', to: 'review', label: 'requiresHuman' },
    ])
    expect(mapper.paused).toBe(true)
    expect(mapper.proposalAmount).toBe(129)
    expect(events[events.length - 1]).toMatchObject({ type: 'interrupt', node: 'review', threadId: 't-2' })
  })

  it('takes the otherwise edge to reply and reports review as skipped on an automatic refund', () => {
    const { events, send } = recorder()
    const mapper = new FrameMapper('t-3', send, 0)
    mapper.onUpdates({ policy: policyChunk(false) })
    mapper.onUpdates({ decide: { trace: [{ node: 'decide', status: 'ok', ms: 3, detail: 'd' }] } })

    expect(events).toContainEqual({ type: 'edge', from: 'decide', to: 'reply', label: 'otherwise' })
    expect(events).toContainEqual({ type: 'node_end', node: 'review', ms: 0, status: 'skipped', detail: NOT_NEEDED_DETAIL })
    expect(mapper.paused).toBe(false)
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
    mapper.onCustom({ type: 'something-else', node: 'intake' })
    mapper.onCustom({ type: 'node_start', node: 'not-a-node' })
    mapper.onUpdates({ notANode: { trace: [] } })
    expect(events).toEqual([])
  })
})
