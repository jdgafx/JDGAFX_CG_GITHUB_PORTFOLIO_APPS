import { describe, expect, it } from 'vitest'
import { QUESTION_MAX_CHARS as SERVER_QUESTION_MAX_CHARS, validateQuestion } from '../../netlify/shared/guard'
import { QUESTION_MAX_CHARS, SAMPLE_QUESTIONS } from '../../src/lib/constants'

describe('example questions', () => {
  it('offers four different questions, each with a label and the path it is expected to take', () => {
    expect(SAMPLE_QUESTIONS.map((sample) => sample.label)).toEqual(['Quick lookup', 'Follow a link', 'Compare two pages', 'Three details'])
    expect(new Set(SAMPLE_QUESTIONS.map((sample) => sample.question)).size).toBe(4)
    for (const sample of SAMPLE_QUESTIONS) expect(sample.path).not.toBe('')
  })

  it('passes the same check the server applies to every question, unchanged', () => {
    expect(QUESTION_MAX_CHARS).toBe(SERVER_QUESTION_MAX_CHARS)
    for (const sample of SAMPLE_QUESTIONS) {
      expect(validateQuestion({ question: sample.question })).toEqual({ ok: true, question: sample.question })
    }
  })
})
