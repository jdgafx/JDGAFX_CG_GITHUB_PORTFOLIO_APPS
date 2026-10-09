import { describe, expect, it } from 'vitest'
import { createSseParser, encodeEvent } from '../../netlify/shared/sse'
import { fixtureChunks } from '../helpers'

describe('createSseParser', () => {
  it('reads events that arrive split anywhere', () => {
    const parser = createSseParser()
    expect(parser.feed('data: {"a":').data).toEqual([])
    expect(parser.feed('1}\n\ndata: {"b":2}\n').data).toEqual(['{"a":1}'])
    expect(parser.feed('\n').data).toEqual(['{"b":2}'])
  })

  it('treats comment lines as heartbeats with no data, and reports them', () => {
    const fed = createSseParser().feed(': ping\n\n: OPENROUTER PROCESSING\n\n')
    expect(fed).toEqual({ data: [], done: false, comment: true })
  })

  it('stops at [DONE] and reads CRLF line ends', () => {
    const fed = createSseParser().feed('data: {"x":1}\r\n\r\ndata: [DONE]\r\n\r\n')
    expect(fed.data).toEqual(['{"x":1}'])
    expect(fed.done).toBe(true)
  })

  it('reads a recorded OpenRouter reply: several events in one network chunk, usage in the last one', () => {
    const parser = createSseParser()
    const payloads = fixtureChunks('plain').flatMap(chunk => parser.feed(chunk).data)
    expect(payloads.length).toBeGreaterThan(4)
    const last = JSON.parse(payloads[payloads.length - 1]) as { usage: { total_tokens: number } }
    expect(last.usage.total_tokens).toBe(653)
  })

  it('encodes an event as one data line', () => {
    expect(encodeEvent({ type: 'delta', text: 'Hi' })).toBe('data: {"type":"delta","text":"Hi"}\n\n')
  })
})
