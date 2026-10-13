import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/ai'
import { MODEL_LIST_URL } from '../../netlify/shared/newest-model'

const PNG = 'aGVsbG8='
const ORIGINAL_KEY = process.env.OPENROUTER_API_KEY
let client = 0

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  if (ORIGINAL_KEY === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = ORIGINAL_KEY
})

function ask(body: Record<string, unknown>): Request {
  client += 1
  return new Request('http://localhost:5173/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173', 'x-nf-client-connection-ip': `10.9.0.${client}` },
    body: JSON.stringify({ image: PNG, mediaType: 'image/png', ...body }),
  })
}

describe('POST /api/ai carries the server clock\'s date to the model', () => {
  it('puts today\'s date from the server clock in the system prompt of the provider call, not a date from the browser', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-13T09:15:00Z'))
    let sent: { messages: Array<{ role: string; content: unknown }> } | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === MODEL_LIST_URL) return new Response(JSON.stringify({ data: [] }), { status: 200 })
        sent = JSON.parse(String(init?.body))
        return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }),
    )
    const res = await handler(ask({ mode: 'qa', question: 'What year is it?', today: '1999-01-01' }))
    await res.text()
    const system = sent!.messages.find(m => m.role === 'system')
    expect(String(system?.content)).toMatch(/Today's date is 2026-10-13\.$/)
    expect(JSON.stringify(sent)).not.toContain('1999-01-01')
  })
})
