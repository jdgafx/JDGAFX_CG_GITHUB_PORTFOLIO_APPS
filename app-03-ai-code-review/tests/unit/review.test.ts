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
    expect(validateComments({ comments: [] }, file(10), 15)).toEqual({ comments: [], dropped: 0, droppedNoIssue: 0, droppedBlank: 0, droppedUnfound: 0, moved: 0 })
  })

  it('drops a line that is zero, fractional or not a number', () => {
    const raw = [
      { line: 0, severity: 'info', message: 'm', suggestion: 's' },
      { line: 1.5, severity: 'info', message: 'm', suggestion: 's' },
      { line: '2', severity: 'info', message: 'm', suggestion: 's' },
    ]
    expect(validateComments(raw, file(3), 15)).toEqual({ comments: [], dropped: 3, droppedNoIssue: 0, droppedBlank: 0, droppedUnfound: 0, moved: 0 })
  })

  it('drops a comment with an empty message or suggestion', () => {
    const raw = [
      { line: 1, severity: 'warning', message: '   ', suggestion: 'fix' },
      { line: 1, severity: 'warning', message: 'problem', suggestion: '' },
    ]
    expect(validateComments(raw, file(3), 15)).toEqual({ comments: [], dropped: 2, droppedNoIssue: 0, droppedBlank: 0, droppedUnfound: 0, moved: 0 })
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

describe('validateComments: issue flag, blank lines and quoted code', () => {
  const lines = ['def f(x):', '    y = x.strip()', '', '    return eval(y)', '', '', '', 'print(f("1"))']
  const comment = (line: number, quote?: string, extra: Record<string, unknown> = {}) => ({
    line,
    ...(quote === undefined ? {} : { quote }),
    severity: 'warning',
    message: 'm',
    suggestion: 's',
    ...extra,
  })
  const linesOf = (raw: unknown[], source = lines) => validateComments(raw, source, 15).comments.map((c) => c.line)

  it('drops a comment the model marked issue: false, and counts it', () => {
    const result = validateComments(
      [comment(2, 'y = x.strip()', { issue: false, message: 'This is fine as written' }), comment(4, 'eval(y)', { issue: true })],
      lines,
      15,
    )
    expect(result.comments.map((c) => c.line)).toEqual([4])
    expect(result).toMatchObject({ dropped: 1, droppedNoIssue: 1, droppedBlank: 0, droppedUnfound: 0 })
  })

  it('does not read a missing or non-boolean issue as "no issue"', () => {
    expect(linesOf([comment(2), comment(4, undefined, { issue: 'no' })])).toEqual([2, 4])
  })

  it('drops a comment on a blank line when it has no quote', () => {
    expect(validateComments([comment(3)], lines, 15)).toMatchObject({ comments: [], dropped: 1, droppedBlank: 1 })
  })

  it('moves a blank-line comment to the line that holds its quote, ignoring spacing', () => {
    const result = validateComments([comment(3, 'return   eval(y)')], lines, 15)
    expect(result.comments.map((c) => c.line)).toEqual([4])
    expect(result).toMatchObject({ dropped: 0, droppedBlank: 0, moved: 1 })
  })

  it('moves a comment to the fragment it is about, up to ten lines away', () => {
    const typo = Array.from({ length: 40 }, (_, i) => `// note ${i + 1}`)
    typo[29] = '// see the the preceding paragraph'
    // The model cited line 37 and quoted the typo itself, which sits on line 30.
    const result = validateComments([comment(37, 'the the')], typo, 15)
    expect(result.comments.map((c) => c.line)).toEqual([30])
    expect(result.moved).toBe(1)
  })

  it('moves to the nearest match, and to the later line on a tie', () => {
    const rows = Array.from({ length: 30 }, (_, i) => `row ${i + 1}`)
    rows[9] = 'dup call()' // line 10, two lines before 12
    rows[14] = 'dup call()' // line 15, three lines after 12
    expect(linesOf([comment(12, 'dup call()')], rows)).toEqual([10])
    rows[13] = 'dup call()' // line 14, two lines after 12: ties with line 10
    expect(linesOf([comment(12, 'dup call()')], rows)).toEqual([14])
  })

  it('finds a fragment that appears once in the file even when it is far away', () => {
    const far = Array.from({ length: 60 }, (_, i) => `row ${i + 1}`)
    far[49] = 'unique_marker = 1'
    expect(linesOf([comment(5, 'unique_marker')], far)).toEqual([50])
  })

  it('drops a comment whose quote is nowhere near and not unique, or not in the file at all', () => {
    const rows = Array.from({ length: 60 }, (_, i) => `row ${i + 1}`)
    rows[40] = 'twice()'
    rows[50] = 'twice()'
    const result = validateComments([comment(5, 'twice()'), comment(6, 'never written')], rows, 15)
    expect(result.comments).toEqual([])
    expect(result).toMatchObject({ dropped: 2, droppedUnfound: 2, droppedBlank: 0 })
  })

  it('counts a quote that is not found from a blank line as a blank-line drop', () => {
    expect(validateComments([comment(5, 'never written')], lines, 15)).toMatchObject({ droppedBlank: 1, droppedUnfound: 0 })
  })

  it('keeps a comment where it is when its quote is on the cited line, or when it has no usable quote', () => {
    expect(linesOf([comment(2, 'x.strip()'), comment(4), comment(4, 'ev')])).toEqual([2, 4, 4])
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

  it('asks for an issue flag and says false discards the comment', () => {
    expect(prompt).toContain('"issue": <true only if something should change')
    expect(prompt).toContain('set "issue" to false and it is discarded')
  })

  it('asks for the quoted code and says blank lines are never cited', () => {
    expect(prompt).toContain('"quote"')
    expect(prompt).toContain('never a blank line')
    expect(prompt).toContain('the exact code fragment this comment is about')
  })
})
