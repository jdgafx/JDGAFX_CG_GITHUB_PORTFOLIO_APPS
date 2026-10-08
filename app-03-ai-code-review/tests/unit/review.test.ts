import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, commentBudget, parseReview, validateComments } from '../../netlify/shared/review'

describe('commentBudget', () => {
  it('never asks for more comments than the file has lines', () => {
    expect(commentBudget(2)).toBe(2)
    expect(commentBudget(3)).toBe(3)
  })

  it('asks for at least five comments on files of five or more lines', () => {
    expect(commentBudget(5)).toBe(5)
    expect(commentBudget(10)).toBe(5)
  })

  it('scales at about one comment per fifteen lines', () => {
    expect(commentBudget(100)).toBe(7)
  })

  it('caps at fifteen comments for long files', () => {
    expect(commentBudget(1000)).toBe(15)
  })
})

describe('buildSystemPrompt', () => {
  it('states the line range and the comment budget the model must respect', () => {
    const prompt = buildSystemPrompt('python', 2, 2)
    expect(prompt).toContain('"line": <integer between 1 and 2>')
    expect(prompt).toContain('Aim for 2 comments in total')
  })
})

describe('parseReview', () => {
  it('strips a markdown fence around the JSON', () => {
    expect(parseReview('```json\n{"comments":[]}\n```')).toEqual({ comments: [] })
  })

  it('strips a fence that has no language tag', () => {
    expect(parseReview('```\n{"comments":[]}\n```')).toEqual({ comments: [] })
  })

  it('extracts the first JSON object from surrounding prose', () => {
    const text = 'Here is the review: {"comments":[{"line":2,"severity":"critical","message":"x","suggestion":"y"}]} thanks'
    const parsed = parseReview(text)
    expect(parsed).not.toBeNull()
    expect(parsed?.comments).toEqual([{ line: 2, severity: 'critical', message: 'x', suggestion: 'y' }])
  })

  it('ignores braces that sit inside string values', () => {
    const text = 'Result: {"comments":[{"line":1,"severity":"info","message":"a } brace","suggestion":"use {x}"}]} end'
    expect(parseReview(text)?.comments).toEqual([
      { line: 1, severity: 'info', message: 'a } brace', suggestion: 'use {x}' },
    ])
  })

  it('returns null when there is no JSON object', () => {
    expect(parseReview('no json here')).toBeNull()
  })

  it('returns null when the JSON was cut short', () => {
    expect(parseReview('{"comments":[{"line":1,"severity":"info"')).toBeNull()
  })

  it('does not read the first object of a bare array as the review', () => {
    expect(parseReview('[{"line":2,"severity":"critical","message":"m","suggestion":"s"}]')).toBeNull()
  })

  it('returns null for an object without a comments array', () => {
    expect(parseReview('{"findings":[]}')).toBeNull()
    expect(parseReview('{"comments":"none"}')).toBeNull()
  })
})

describe('validateComments', () => {
  it('keeps only comments that cite a real line with valid fields, and counts the rest as dropped', () => {
    const raw = [
      { line: 2, severity: 'critical', message: ' Division by zero ', suggestion: 'Guard b === 0' },
      { line: 9, severity: 'warning', message: 'beyond the file', suggestion: 's' },
      { line: 1, severity: 'praise', message: 'unknown severity', suggestion: 's' },
      'junk',
    ]
    const { comments, dropped } = validateComments(raw, 3)
    expect(comments).toEqual([
      { line: 2, severity: 'critical', message: 'Division by zero', suggestion: 'Guard b === 0' },
    ])
    expect(dropped).toBe(3)
  })

  it('treats a non-array as an empty list', () => {
    expect(validateComments({ comments: [] }, 10)).toEqual({ comments: [], dropped: 0 })
  })

  it('drops a line that is zero, fractional or not a number', () => {
    const raw = [
      { line: 0, severity: 'info', message: 'm', suggestion: 's' },
      { line: 1.5, severity: 'info', message: 'm', suggestion: 's' },
      { line: '2', severity: 'info', message: 'm', suggestion: 's' },
    ]
    expect(validateComments(raw, 3)).toEqual({ comments: [], dropped: 3 })
  })

  it('drops a comment with an empty message or suggestion', () => {
    const raw = [
      { line: 1, severity: 'warning', message: '   ', suggestion: 'fix' },
      { line: 1, severity: 'warning', message: 'problem', suggestion: '' },
    ]
    expect(validateComments(raw, 3)).toEqual({ comments: [], dropped: 2 })
  })

  it('keeps no more comments than the budget', () => {
    const raw = [1, 2, 3, 4].map((line) => ({ line, severity: 'info', message: `m${line}`, suggestion: 's' }))
    const { comments, dropped } = validateComments(raw, 4, 2)
    expect(comments.map((c) => c.line)).toEqual([1, 2])
    expect(dropped).toBe(2)
  })

  it('keeps at most fifteen comments when no budget is given', () => {
    const raw = Array.from({ length: 16 }, (_, i) => ({ line: i + 1, severity: 'info', message: 'm', suggestion: 's' }))
    const { comments, dropped } = validateComments(raw, 20)
    expect(comments).toHaveLength(15)
    expect(dropped).toBe(1)
  })

  it('caps long text at 600 characters', () => {
    const raw = [{ line: 1, severity: 'info', message: 'x'.repeat(700), suggestion: 's' }]
    expect(validateComments(raw, 1).comments[0].message).toHaveLength(600)
  })
})
