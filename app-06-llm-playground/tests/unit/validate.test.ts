import { describe, expect, it } from 'vitest'
import { parseCompare, parseJudge } from '../../netlify/shared/validate'

const good = { prompt: 'Reply with exactly the word READY.', models: ['a/x', 'b/y', 'c/z'] }

describe('parseCompare', () => {
  it('keeps the prompt and the three model IDs in order', () => {
    expect(parseCompare(good)).toEqual({
      ok: true,
      value: { prompt: good.prompt, models: ['a/x', 'b/y', 'c/z'], system: undefined, temperature: undefined },
    })
  })

  it('keeps a system prompt and a temperature when they are given', () => {
    const result = parseCompare({ ...good, system: 'Be brief.', temperature: 0.2 })
    expect(result).toEqual({
      ok: true,
      value: { prompt: good.prompt, models: ['a/x', 'b/y', 'c/z'], system: 'Be brief.', temperature: 0.2 },
    })
  })

  it('treats an empty system prompt as absent', () => {
    expect(parseCompare({ ...good, system: '' })).toMatchObject({ ok: true, value: { system: undefined } })
  })

  it('rejects a blank prompt or one over 4000 characters', () => {
    const message = 'Prompt must be 1 to 4000 characters'
    expect(parseCompare({ ...good, prompt: '   ' })).toEqual({ ok: false, error: message })
    expect(parseCompare({ ...good, prompt: 'x'.repeat(4001) })).toEqual({ ok: false, error: message })
    expect(parseCompare({ ...good, prompt: 'x'.repeat(4000) }).ok).toBe(true)
  })

  it('accepts only exactly three non-empty model IDs of at most 200 characters', () => {
    const message = 'models must list three model IDs'
    expect(parseCompare({ ...good, models: ['a/x', 'b/y'] })).toEqual({ ok: false, error: message })
    expect(parseCompare({ ...good, models: ['a/x', 'b/y', 3] })).toEqual({ ok: false, error: message })
    expect(parseCompare({ ...good, models: ['a/x', '', 'c/z'] })).toEqual({ ok: false, error: message })
    expect(parseCompare({ ...good, models: ['a/x', 'b'.repeat(201), 'c/z'] })).toEqual({ ok: false, error: message })
    expect(parseCompare({ ...good, models: ['a/x', 'b'.repeat(200), 'c/z'] }).ok).toBe(true)
  })

  it('rejects a system prompt over 2000 characters or a non-text system prompt', () => {
    const message = 'System prompt must be 2000 characters or fewer'
    expect(parseCompare({ ...good, system: 'x'.repeat(2001) })).toEqual({ ok: false, error: message })
    expect(parseCompare({ ...good, system: 42 })).toEqual({ ok: false, error: message })
    expect(parseCompare({ ...good, system: null })).toEqual({ ok: false, error: message })
  })

  it('rejects a temperature outside 0 to 1', () => {
    const message = 'Temperature must be between 0 and 1'
    expect(parseCompare({ ...good, temperature: 1.5 })).toEqual({ ok: false, error: message })
    expect(parseCompare({ ...good, temperature: -0.1 })).toEqual({ ok: false, error: message })
    expect(parseCompare({ ...good, temperature: '0.5' })).toEqual({ ok: false, error: message })
  })

  it('rejects a body that is not an object', () => {
    expect(parseCompare(['x'])).toEqual({ ok: false, error: 'Request body must be a JSON object' })
    expect(parseCompare(null)).toEqual({ ok: false, error: 'Request body must be a JSON object' })
  })
})

describe('parseJudge', () => {
  it('accepts one to three answers with unique slots', () => {
    const result = parseJudge({ prompt: 'Q', answers: [{ slot: 'A', text: 'One.' }, { slot: 'C', text: 'Three.' }] })
    expect(result).toEqual({
      ok: true,
      value: { prompt: 'Q', answers: [{ slot: 'A', text: 'One.' }, { slot: 'C', text: 'Three.' }] },
    })
  })

  it('rejects an empty list, a repeated slot, an unknown slot or a blank answer', () => {
    const message = 'Each answer needs a unique slot (A, B or C) and text'
    expect(parseJudge({ prompt: 'Q', answers: [] })).toEqual({ ok: false, error: 'Send between 1 and 3 answers' })
    expect(parseJudge({ prompt: 'Q', answers: [{ slot: 'A', text: 'x' }, { slot: 'A', text: 'y' }] })).toEqual({ ok: false, error: message })
    expect(parseJudge({ prompt: 'Q', answers: [{ slot: 'D', text: 'x' }] })).toEqual({ ok: false, error: message })
    expect(parseJudge({ prompt: 'Q', answers: [{ slot: 'B', text: '  ' }] })).toEqual({ ok: false, error: message })
  })

  it('rejects four answers', () => {
    const four = ['A', 'B', 'C', 'A'].map(slot => ({ slot, text: 'x' }))
    expect(parseJudge({ prompt: 'Q', answers: four })).toEqual({ ok: false, error: 'Send between 1 and 3 answers' })
  })

  it('accepts answers at the limits: 8000 characters each and 20000 in total', () => {
    const result = parseJudge({
      prompt: 'Q',
      answers: [
        { slot: 'A', text: 'a'.repeat(8000) },
        { slot: 'B', text: 'b'.repeat(8000) },
        { slot: 'C', text: 'c'.repeat(4000) },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.answers.map(a => a.text.length)).toEqual([8000, 8000, 4000])
  })

  it('refuses an answer over 8000 characters, rather than cutting it', () => {
    expect(parseJudge({ prompt: 'Q', answers: [{ slot: 'A', text: 'x'.repeat(8001) }] })).toEqual({
      ok: false,
      error: 'Each answer must be 8000 characters or fewer',
    })
  })

  it('refuses answers that together exceed 20000 characters', () => {
    expect(
      parseJudge({
        prompt: 'Q',
        answers: [
          { slot: 'A', text: 'a'.repeat(8000) },
          { slot: 'B', text: 'b'.repeat(8000) },
          { slot: 'C', text: 'c'.repeat(4001) },
        ],
      }),
    ).toEqual({ ok: false, error: 'The answers together must be 20000 characters or fewer' })
  })
})
