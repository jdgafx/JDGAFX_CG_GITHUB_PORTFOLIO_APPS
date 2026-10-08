import { describe, expect, it } from 'vitest'
import { DONE_FRAME, encodeFrame, type Frame } from '../../netlify/shared/events'

describe('encodeFrame', () => {
  it('writes one data line followed by a blank line', () => {
    expect(encodeFrame({ type: 'error', message: 'The request failed.' })).toBe(
      'data: {"type":"error","message":"The request failed."}\n\n',
    )
  })

  it('escapes newlines inside a frame, so one frame is always one data line', () => {
    const text = encodeFrame({ type: 'error', message: 'Line one\nLine two' })
    expect(text).toBe('data: {"type":"error","message":"Line one\\nLine two"}\n\n')
    expect(text.slice(0, -2).includes('\n')).toBe(false)
  })

  it('round-trips a node_end frame with its usage and cost', () => {
    const frame: Frame = {
      type: 'node_end',
      node: 'critic',
      visit: 2,
      ms: 812,
      status: 'ok',
      detail: 'Accepted.',
      model: '~anthropic/claude-haiku-latest',
      servedModel: 'anthropic/claude-haiku-test',
      usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 },
      cost: 0.000111,
      costSource: 'usage',
    }
    const text = encodeFrame(frame)
    expect(text.startsWith('data: ')).toBe(true)
    expect(JSON.parse(text.slice('data: '.length, -2))).toEqual(frame)
  })

  it('drops fields that are undefined rather than sending them as null', () => {
    const text = encodeFrame({ type: 'node_start', node: 'plan', visit: 1, ms: 0 })
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('null')
  })
})

describe('DONE_FRAME', () => {
  it('is the exact end-of-stream record', () => {
    expect(DONE_FRAME).toBe('data: [DONE]\n\n')
  })
})
