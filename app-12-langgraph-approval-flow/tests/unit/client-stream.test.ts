import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchThread, processSSELines, RequestFailure, resumeThread, startIssue } from '../../src/lib/api'
import type { StreamEvent } from '../../netlify/shared/events'
import { QUESTION } from '../helpers/issues'

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

describe('startIssue', () => {
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
    await startIssue(QUESTION, (event) => seen.push(event))
    const [path, init] = vi.mocked(fetch).mock.calls[0]
    expect(path).toBe('/api/start')
    expect(JSON.parse(String(init?.body))).toEqual({ issue: QUESTION })
    expect(seen).toEqual([
      { type: 'thread', threadId: 'abc' },
      { type: 'error', message: 'stopped' },
    ])
  })

  it('shows the server plain-language error when the start is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'The issue title must be 1 to 300 characters.' }), { status: 400 })),
    )
    await expect(startIssue(QUESTION, () => {})).rejects.toMatchObject({
      name: 'RequestFailure',
      message: 'The issue title must be 1 to 300 characters.',
    })
  })

  it('refuses an HTML page that came back where the run stream should be', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>site</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })))
    const failure = await startIssue(QUESTION, () => {}).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(RequestFailure)
    expect((failure as Error).message).toContain('did not start a run')
  })

  it('reports an unreachable server in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network down'))))
    await expect(startIssue(QUESTION, () => {})).rejects.toThrow(
      'Could not reach the server.',
    )
  })

  it('marks a lost connection and a server error on the failure, so the page can tell them from a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network down'))))
    const lost = await resumeThread('t-1', { action: 'approve' }, () => {}).catch((err: unknown) => err)
    expect(lost).toMatchObject({ connection: true, status: undefined })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'Busy.' }), { status: 503 })))
    const busy = await resumeThread('t-1', { action: 'approve' }, () => {}).catch((err: unknown) => err)
    expect(busy).toMatchObject({ connection: false, status: 503, message: 'Busy.' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'This thread is not awaiting approval.' }), { status: 409 })))
    const refused = await resumeThread('t-1', { action: 'approve' }, () => {}).catch((err: unknown) => err)
    expect(refused).toMatchObject({ connection: false, status: 409 })
  })

  it('reads the issue from a thread, and refuses a thread body without one', async () => {
    const view = { success: true, threadId: 't-1', title: 'acme/widgets #101', issue: QUESTION, status: 'completed' }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(view), { status: 200 })))
    await expect(fetchThread('t-1')).resolves.toMatchObject({ issue: { repo: 'acme/widgets', number: 101 } })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...view, issue: 42 }), { status: 200 })))
    await expect(fetchThread('t-1')).rejects.toThrow('could not read')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 200 })))
    await expect(fetchThread('t-1')).rejects.toThrow('could not read')
  })
})
