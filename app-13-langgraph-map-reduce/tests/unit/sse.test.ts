import { describe, expect, it } from 'vitest'
import { createSseParser } from '../../src/lib/sse'

describe('createSseParser', () => {
  it('reads frames even when the bytes arrive split in the middle of an event', () => {
    const parser = createSseParser()
    const first = parser.feed('data: {"type":"error",')
    const second = parser.feed('"message":"Nope."}\n\ndata: {"type":"edge","from":"split","to":"extract","label":"fan out: 2 chunks"}\n\n')

    expect(first).toEqual({ frames: [], finished: false })
    expect(second.frames).toEqual([
      { type: 'error', message: 'Nope.' },
      { type: 'edge', from: 'split', to: 'extract', label: 'fan out: 2 chunks' },
    ])
  })

  it('finishes on the DONE line and skips a payload that is not JSON', () => {
    const parser = createSseParser()
    const feed = parser.feed('data: not json\n\ndata: {"type":"error","message":"x"}\n\ndata: [DONE]\n\n')

    expect(feed.frames).toEqual([{ type: 'error', message: 'x' }])
    expect(feed.finished).toBe(true)
  })

  it('accepts CRLF line endings', () => {
    const parser = createSseParser()
    const feed = parser.feed('data: {"type":"error","message":"crlf"}\r\n\r\n')

    expect(feed.frames).toEqual([{ type: 'error', message: 'crlf' }])
  })
})
