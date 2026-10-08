import { describe, expect, it } from 'vitest'
import { DONE_FRAME, encodeFrame } from '../../netlify/shared/events'

describe('encodeFrame', () => {
  it('writes one server-sent event with a JSON payload on a single data line', () => {
    expect(encodeFrame({ type: 'error', message: 'Something went wrong.' })).toBe(
      'data: {"type":"error","message":"Something went wrong."}\n\n',
    )
  })

  it('keeps line breaks inside the payload escaped, so one event never spans two lines', () => {
    const encoded = encodeFrame({ type: 'error', message: 'first\nsecond' })

    expect(encoded.split('\n')).toEqual(['data: {"type":"error","message":"first\\nsecond"}', '', ''])
  })

  it('ends a stream with the DONE line', () => {
    expect(DONE_FRAME).toBe('data: [DONE]\n\n')
  })
})
