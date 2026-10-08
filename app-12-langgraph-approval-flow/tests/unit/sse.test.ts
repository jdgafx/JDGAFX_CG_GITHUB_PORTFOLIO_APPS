import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunBudget } from '../../netlify/shared/budget'
import { SERVER_ERROR } from '../../netlify/shared/guard'
import { streamResponse } from '../../netlify/shared/sse'
import { parseFrames } from '../helpers/http'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('streamResponse', () => {
  it('sends each event in order, then [DONE]', async () => {
    const response = streamResponse(new RunBudget(), async (send) => {
      send({ type: 'thread', threadId: 't-1' })
      send({ type: 'error', message: 'stopped' })
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(parseFrames(await response.text())).toEqual([
      { type: 'thread', threadId: 't-1' },
      { type: 'error', message: 'stopped' },
      '[DONE]',
    ])
  })

  it('ends with an error frame and [DONE] when the work throws', async () => {
    const response = streamResponse(new RunBudget(), async (send) => {
      send({ type: 'thread', threadId: 't-2' })
      throw new Error('boom')
    })
    expect(parseFrames(await response.text())).toEqual([
      { type: 'thread', threadId: 't-2' },
      { type: 'error', message: SERVER_ERROR },
      '[DONE]',
    ])
  })

  it('gives the work a signal that aborts when the budget runs out, and still ends with [DONE]', async () => {
    const response = streamResponse(
      new RunBudget(5),
      (_send, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('budget spent')))
        }),
    )
    expect(parseFrames(await response.text())).toEqual([{ type: 'error', message: SERVER_ERROR }, '[DONE]'])
  })
})
