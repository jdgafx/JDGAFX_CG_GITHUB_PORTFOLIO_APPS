import { afterEach, describe, expect, it, vi } from 'vitest'
import { processSSELines, RequestFailure, startTicket } from '../../src/lib/api'
import type { StreamEvent } from '../../netlify/shared/events'

afterEach(() => {
  vi.unstubAllGlobals()
})

function sse(...events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
}

describe('processSSELines', () => {
  it('delivers each event in order and reports the end marker', () => {
    const seen: StreamEvent[] = []
    const ended = processSSELines(
      ['data: {"type":"thread","threadId":"t"}', '', 'data: {"type":"error","message":"m"}', 'data: [DONE]'],
      (event) => seen.push(event),
    )
    expect(ended).toBe(true)
    expect(seen).toEqual([
      { type: 'thread', threadId: 't' },
      { type: 'error', message: 'm' },
    ])
  })

  it('skips lines that are not data, and frames that are not JSON with a type', () => {
    const seen: StreamEvent[] = []
    const ended = processSSELines(
      [': comment', 'event: ping', 'data: {broken', 'data: {"no":"type"}', 'data: {"type":"error","message":"ok"}'],
      (event) => seen.push(event),
    )
    expect(ended).toBe(false)
    expect(seen).toEqual([{ type: 'error', message: 'ok' }])
  })
})

describe('startTicket', () => {
  it('reads a server-sent answer from the start function to its end marker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(sse({ type: 'thread', threadId: 'abc' }, { type: 'error', message: 'stopped' }), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
          }),
      ),
    )
    const seen: StreamEvent[] = []
    await startTicket('Order ORD-1077 arrived damaged, please refund.', (event) => seen.push(event))
    expect(seen).toEqual([
      { type: 'thread', threadId: 'abc' },
      { type: 'error', message: 'stopped' },
    ])
  })

  it('shows the server plain-language error when the start is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'The ticket must be 10 to 2,000 characters.' }), { status: 400 })),
    )
    await expect(startTicket('short', () => {})).rejects.toMatchObject({
      name: 'RequestFailure',
      message: 'The ticket must be 10 to 2,000 characters.',
    })
  })

  it('refuses an HTML page that came back where the run stream should be', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>site</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })))
    const failure = await startTicket('Order ORD-1077 arrived damaged, please refund.', () => {}).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(RequestFailure)
    expect((failure as Error).message).toContain('did not start a run')
  })

  it('reports an unreachable server in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network down'))))
    await expect(startTicket('Order ORD-1077 arrived damaged, please refund.', () => {})).rejects.toThrow(
      'Could not reach the server.',
    )
  })
})
