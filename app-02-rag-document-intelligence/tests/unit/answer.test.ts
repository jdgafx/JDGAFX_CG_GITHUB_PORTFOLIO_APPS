import { describe, it, expect } from 'vitest'
import { parseAnswer } from '../../netlify/shared/answer'

const EMPTY = 'The model returned an empty response. Please try again.'
const MALFORMED = 'The model returned a malformed response. Please try again.'
const INVALID = 'The model returned an invalid response structure. Please try again.'

describe('parseAnswer', () => {
  it('reads the answer, the citations and the confidence', () => {
    const reply = '{"answer":"The Harbor Station opened in 1987.","source_chunk_indices":[0,2],"confidence":0.9}'
    expect(parseAnswer(reply, [0, 1, 2])).toEqual({
      ok: true,
      result: { answer: 'The Harbor Station opened in 1987.', source_chunk_indices: [0, 2], confidence: 0.9 },
    })
  })

  it('reads a reply wrapped in a code fence or in prose', () => {
    const fenced = '```json\n{"answer":"Yes.","source_chunk_indices":[0],"confidence":0.8}\n```'
    const prose = 'Here it is: {"answer":"Yes.","source_chunk_indices":[0],"confidence":0.8} Hope that helps.'
    expect(parseAnswer(fenced, [0])).toMatchObject({ ok: true, result: { answer: 'Yes.', source_chunk_indices: [0] } })
    expect(parseAnswer(prose, [0])).toMatchObject({ ok: true, result: { answer: 'Yes.', source_chunk_indices: [0] } })
  })

  it('keeps only citations that name a passage that was sent, each once', () => {
    const reply = '{"answer":"x","source_chunk_indices":[1,7,1,-1,1.5,"2"],"confidence":0.5}'
    expect(parseAnswer(reply, [1, 2])).toMatchObject({ ok: true, result: { source_chunk_indices: [1] } })
  })

  it('clamps the self-rated confidence to the range 0 to 1', () => {
    const high = parseAnswer('{"answer":"x","source_chunk_indices":[],"confidence":1.7}', [])
    const low = parseAnswer('{"answer":"x","source_chunk_indices":[],"confidence":-0.3}', [])
    expect(high).toMatchObject({ ok: true, result: { confidence: 1 } })
    expect(low).toMatchObject({ ok: true, result: { confidence: 0 } })
  })

  it('rejects an empty reply and an empty answer', () => {
    expect(parseAnswer('   ', [0])).toEqual({ ok: false, message: EMPTY })
    expect(parseAnswer('{"answer":"  ","source_chunk_indices":[0],"confidence":0.8}', [0])).toEqual({ ok: false, message: EMPTY })
  })

  it('rejects text that is not JSON', () => {
    expect(parseAnswer('{"answer": ', [0])).toEqual({ ok: false, message: MALFORMED })
  })

  it('rejects a reply with a missing confidence or a non-list of citations', () => {
    expect(parseAnswer('{"answer":"x","source_chunk_indices":[0]}', [0])).toEqual({ ok: false, message: INVALID })
    expect(parseAnswer('{"answer":"x","source_chunk_indices":"0","confidence":0.5}', [0])).toEqual({ ok: false, message: INVALID })
  })
})
