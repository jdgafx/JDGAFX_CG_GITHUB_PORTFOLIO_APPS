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

/** A file of `n` code lines: "line 1", "line 2", ... */
const file = (n: number): string[] => Array.from({ length: n }, (_, i) => `line ${i + 1}`)

describe('validateComments', () => {
  it('keeps only comments that cite a real line with valid fields, and counts the rest as dropped', () => {
    const raw = [
      { line: 2, severity: 'critical', message: ' Division by zero ', suggestion: 'Guard b === 0' },
      { line: 9, severity: 'warning', message: 'beyond the file', suggestion: 's' },
      { line: 1, severity: 'praise', message: 'unknown severity', suggestion: 's' },
      'junk',
    ]
    const { comments, dropped } = validateComments(raw, file(3), 15)
    expect(comments).toEqual([
      { line: 2, severity: 'critical', message: 'Division by zero', suggestion: 'Guard b === 0' },
    ])
    expect(dropped).toBe(3)
  })

  it('treats a non-array as an empty list', () => {
    expect(validateComments({ comments: [] }, file(10), 15)).toEqual({ comments: [], dropped: 0, droppedBlank: 0, moved: 0 })
  })

  it('drops a line that is zero, fractional or not a number', () => {
    const raw = [
      { line: 0, severity: 'info', message: 'm', suggestion: 's' },
      { line: 1.5, severity: 'info', message: 'm', suggestion: 's' },
      { line: '2', severity: 'info', message: 'm', suggestion: 's' },
    ]
    expect(validateComments(raw, file(3), 15)).toEqual({ comments: [], dropped: 3, droppedBlank: 0, moved: 0 })
  })

  it('drops a comment with an empty message or suggestion', () => {
    const raw = [
      { line: 1, severity: 'warning', message: '   ', suggestion: 'fix' },
      { line: 1, severity: 'warning', message: 'problem', suggestion: '' },
    ]
    expect(validateComments(raw, file(3), 15)).toEqual({ comments: [], dropped: 2, droppedBlank: 0, moved: 0 })
  })

  it('keeps no more comments than the budget', () => {
    const raw = [1, 2, 3, 4].map((line) => ({ line, severity: 'info', message: `m${line}`, suggestion: 's' }))
    const { comments, dropped } = validateComments(raw, file(4), 2)
    expect(comments.map((c) => c.line)).toEqual([1, 2])
    expect(dropped).toBe(2)
  })

  it('caps long text at 600 characters', () => {
    const raw = [{ line: 1, severity: 'info', message: 'x'.repeat(700), suggestion: 's' }]
    expect(validateComments(raw, file(1), 15).comments[0].message).toHaveLength(600)
  })
})

describe('validateComments: blank and misplaced lines', () => {
  const lines = ['def f(x):', '    y = x.strip()', '', '    return eval(y)', '', '', '', 'print(f("1"))']
  const comment = (line: number, quote?: string) => ({
    line,
    ...(quote === undefined ? {} : { quote }),
    severity: 'warning',
    message: 'm',
    suggestion: 's',
  })

  it('drops a comment on a blank line when it has no quote', () => {
    expect(validateComments([comment(3)], lines, 15)).toEqual({ comments: [], dropped: 1, droppedBlank: 1, moved: 0 })
  })

  it('drops a comment on a blank line when no nearby line holds its quote', () => {
    const result = validateComments([comment(6, 'y = x.strip()')], lines, 15)
    expect(result).toEqual({ comments: [], dropped: 1, droppedBlank: 1, moved: 0 })
  })

  it('moves a blank-line comment to the nearby line that holds its quote, ignoring spacing', () => {
    const result = validateComments([comment(3, 'return   eval(y)')], lines, 15)
    expect(result.comments.map((c) => c.line)).toEqual([4])
    expect(result).toMatchObject({ dropped: 0, droppedBlank: 0, moved: 1 })
  })

  it('looks only two lines either way', () => {
    // Line 8 holds the quote and is three lines from the blank line 5.
    expect(validateComments([comment(5, 'print(f("1"))')], lines, 15).comments).toEqual([])
    expect(validateComments([comment(6, 'print(f("1"))')], lines, 15).comments.map((c) => c.line)).toEqual([8])
  })

  it('moves a comment off a code line when it quotes code that sits two lines away', () => {
    const result = validateComments([comment(2, 'return eval(y)')], lines, 15)
    expect(result.comments.map((c) => c.line)).toEqual([4])
    expect(result.moved).toBe(1)
  })

  it('keeps a comment where it is when the quote matches, is missing or matches nothing near', () => {
    const kept = validateComments([comment(2, 'y = x.strip()'), comment(4), comment(4, 'something else entirely')], lines, 15)
    expect(kept.comments.map((c) => c.line)).toEqual([2, 4, 4])
    expect(kept).toMatchObject({ dropped: 0, droppedBlank: 0, moved: 0 })
  })

  it('does not treat a one or two character quote as a match', () => {
    expect(validateComments([comment(3, '(')], lines, 15).comments).toEqual([])
  })
})

describe('buildSystemPrompt: severity and quoting', () => {
  const prompt = buildSystemPrompt('go', 100, 7)

  it('defines critical as exploitable, crashing, data-losing or a definite reachable bug', () => {
    expect(prompt).toContain('only an exploitable security hole, a crash, data loss, or a definite bug')
    expect(prompt).toContain('A type cast, a style problem')
  })

  it('tells the model that a comment concluding the code is fine is not a finding', () => {
    expect(prompt).toContain('concludes the code is fine, safe or correct is not a finding')
  })

  it('asks for the quoted code and says blank lines are never cited', () => {
    expect(prompt).toContain('"quote"')
    expect(prompt).toContain('never a blank line')
  })
})
