import { describe, expect, it } from 'vitest'
import { DONE_FRAME, encodeFrame, readProviderStream, type ProviderAnswer } from '../../netlify/shared/stream'

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function read(chunks: string[]): Promise<{ answer: ProviderAnswer; emitted: object[] }> {
  const emitted: object[] = []
  const answer = await readProviderStream(
    streamOf(chunks),
    (frame) => {
      emitted.push(frame)
    },
    new AbortController().signal,
  )
  return { answer, emitted }
}

describe('encodeFrame', () => {
  it('writes one SSE data line followed by a blank line', () => {
    expect(encodeFrame({ text: 'Hi "there"' })).toBe('data: {"text":"Hi \\"there\\""}\n\n')
    expect(DONE_FRAME).toBe('data: [DONE]\n\n')
  })
})

describe('readProviderStream', () => {
  it('joins deltas split across network chunks and keeps the model, finish reason, usage and [DONE]', async () => {
    const { answer, emitted } = await read([
      'data: {"model":"anthropic/claude-haiku-5.5","choices":[{"delta":{"content":"Net"}}]}\n\ndat',
      'a: {"choices":[{"delta":{"content":"ix up 30.9%"},"finish_reason":"stop"}]}\n\n: OPENROUTER PROCESSING\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":812,"completion_tokens":240,"total_tokens":1052,"cost":0.000421,"extra":1}}\n\ndata: [DONE]\n\n',
    ])
    expect(answer).toEqual({
      text: 'Netix up 30.9%',
      chunks: 2,
      finishReason: 'stop',
      model: 'anthropic/claude-haiku-5.5',
      usage: { prompt_tokens: 812, completion_tokens: 240, total_tokens: 1052, cost: 0.000421 },
      providerError: null,
      done: true,
    })
    expect(emitted).toEqual([{ text: 'Net' }, { text: 'ix up 30.9%' }])
  })

  it('reports a provider error frame as its status code and emits no text', async () => {
    const { answer, emitted } = await read(['data: {"error":{"code":402,"message":"Insufficient credits"}}\n\n'])
    expect(answer.providerError).toBe(402)
    expect(answer.text).toBe('')
    expect(emitted).toEqual([])
  })

  it('skips a frame that is not valid JSON and keeps reading', async () => {
    const { answer } = await read([
      'data: {"choices":[{"delta":{"content":"A"\n\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\n',
    ])
    expect(answer.text).toBe('B')
    expect(answer.chunks).toBe(1)
  })

  it('reads a final frame that has no trailing newline', async () => {
    const { answer } = await read(['data: {"choices":[{"delta":{"content":"tail"}}]}'])
    expect(answer.text).toBe('tail')
  })

  it('treats a null frame as an empty frame', async () => {
    const { answer } = await read(['data: null\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n'])
    expect(answer.text).toBe('ok')
  })

  it('skips deltas that are not non-empty text', async () => {
    const { answer, emitted } = await read([
      'data: {"choices":[{"delta":{"content":5}}]}\n\n',
      'data: {"choices":[{"delta":{"content":null}}]}\n\n',
      'data: {"choices":[{"delta":{"content":{"x":1}}}]}\n\n',
      'data: {"choices":[{"delta":{"content":""}}]}\n\n',
    ])
    expect(answer.chunks).toBe(0)
    expect(answer.text).toBe('')
    expect(emitted).toEqual([])
  })

  it('records a stream that never sent [DONE] as not done and without a finish reason', async () => {
    const { answer } = await read(['data: {"choices":[{"delta":{"content":"A"}}]}\n\n'])
    expect(answer.done).toBe(false)
    expect(answer.finishReason).toBeNull()
  })

  it('returns what arrived when the signal aborts while the body stays open', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'))
      },
    })
    const abort = new AbortController()
    const pending = readProviderStream(body, () => undefined, abort.signal)
    await new Promise((resolve) => setTimeout(resolve, 5))
    abort.abort()
    const answer = await pending
    expect(answer.text).toBe('Partial')
    expect(answer.done).toBe(false)
  })
})
