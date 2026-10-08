import type { RunBudget } from './budget'
import { DONE_FRAME, encodeFrame, SSE_HEADERS, type StreamEvent } from './events'
import { SERVER_ERROR } from './guard'

export type StreamWork = (send: (event: StreamEvent) => void, signal: AbortSignal) => Promise<void>

/**
 * A server-sent response. The work runs inside the stream, so each event reaches the browser as it is
 * produced. The budget's signal is passed to the work, and the budget's timer is cleared when the work
 * ends however it ends. A client that disconnects does not abort the run: it finishes and is indexed.
 */
export function streamResponse(budget: RunBudget, work: StreamWork): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(encodeFrame(event)))
        } catch {
          // The reader has gone. The run keeps going and its result is stored.
        }
      }
      try {
        await work(send, budget.signal)
      } catch (err) {
        console.error('GraphGate: stream failed', err)
        send({ type: 'error', message: SERVER_ERROR })
      } finally {
        budget.dispose()
        try {
          controller.enqueue(encoder.encode(DONE_FRAME))
          controller.close()
        } catch {
          // Already closed.
        }
      }
    },
  })
  return new Response(body, { status: 200, headers: SSE_HEADERS })
}
