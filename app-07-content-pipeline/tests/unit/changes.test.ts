import { describe, expect, it } from 'vitest'
import { CHANGES_DELIMITER, notesDetail, splitChanges, verifyNotes } from '../../netlify/shared/changes'

const BEFORE = 'Rust began in 2006. Mozilla sponsored it from 2009. It guarantees memory safety without a garbage collector.'
const AFTER = 'Rust began in 2006 as a side project. Mozilla sponsored it from 2009. It provides memory safety with no garbage collector at all.'

describe('splitChanges', () => {
  it('splits the text from the note lines at the delimiter', () => {
    const reply = `Piece one.\n\nSecond.\n\n${CHANGES_DELIMITER}\n- Added context :: as a side project\n\n- Tightened :: with no garbage collector\n`
    expect(splitChanges(reply)).toEqual({
      text: 'Piece one.\n\nSecond.',
      noteLines: ['- Added context :: as a side project', '- Tightened :: with no garbage collector'],
      hadDelimiter: true,
    })
  })

  it('accepts a === delimiter in any case and returns the whole reply when there is none', () => {
    expect(splitChanges('Body.\n===changes===\n- x :: y').hadDelimiter).toBe(true)
    expect(splitChanges('Body.\n\nA changes heading')).toEqual({ text: 'Body.\n\nA changes heading', noteLines: [], hadDelimiter: false })
  })
})

describe('verifyNotes', () => {
  it('keeps a note whose passage is inserted text, with the side it is on', () => {
    const notes = verifyNotes(['- Added where the project started :: as a side project'], BEFORE, AFTER)
    expect(notes).toEqual([{ text: 'Added where the project started', passage: 'as a side project', side: 'new' }])
  })

  it('keeps a note about removed words, on the old side', () => {
    const notes = verifyNotes(['- Dropped the strong claim :: guarantees memory safety without'], BEFORE, AFTER)
    expect(notes[0]).toMatchObject({ side: 'old', passage: 'guarantees memory safety without' })
  })

  it('drops a note whose passage is in the text but was not changed', () => {
    expect(verifyNotes(['- Kept the date tidy :: Mozilla sponsored it from 2009'], BEFORE, AFTER)).toEqual([])
  })

  it('drops a note whose passage is not in either text', () => {
    expect(verifyNotes(['- Invented a change :: a rewritten opening line'], BEFORE, AFTER)).toEqual([])
  })

  it('matches words regardless of case, quotes and trailing punctuation', () => {
    expect(verifyNotes(['- Added some context :: "As a side project,"'], BEFORE, AFTER)).toHaveLength(1)
  })

  it('drops a reason that is too short, a line with no passage, and a passage used twice', () => {
    const lines = ['- Fixed :: as a side project', '- Added where the project started', '- Added where it started :: as a side project', '- Added origin story detail :: as a side project']
    const kept = verifyNotes(lines, BEFORE, AFTER)
    expect(kept.map(n => n.text)).toEqual(['Added where it started'])
  })

  it('accepts the || separator, strips bullets and numbers, and keeps at most five', () => {
    const lines = Array.from({ length: 8 }, (_, i) => `${i + 1}. Added a distinct word ${i} || as a side project`.replace('side project', i === 0 ? 'side project' : `side project ${i}`))
    expect(verifyNotes(lines.slice(0, 1), BEFORE, AFTER)).toHaveLength(1)
    expect(verifyNotes(lines, BEFORE, AFTER).length).toBeLessThanOrEqual(5)
  })
})

describe('notesDetail', () => {
  it('says what happened to the notes', () => {
    expect(notesDetail(4, 2, true)).toBe('2 of 4 change notes kept.')
    expect(notesDetail(1, 1, true)).toBe('1 of 1 change note kept.')
    expect(notesDetail(3, 0, true)).toBe('No change note matched a real change (3 dropped).')
    expect(notesDetail(0, 0, false)).toBe('No change notes came back.')
  })
})

describe('verifyNotes: a reason whose own claim is false is dropped', () => {
  const OLD = 'The tool is free to the public. It runs fast. It is small.'
  it('drops "removed" when the named words are still in the new text, keeps it when they are gone', () => {
    const after = 'The tool is free to the public now. It runs fast. It is small.'
    expect(verifyNotes(['- Removed the claim about the public :: free to the public'], OLD, after)).toEqual([])
    const gone = 'The tool is free. It runs fast. It is small.'
    expect(verifyNotes(['- Removed the claim about the public :: to the public'], OLD, gone)).toEqual([
      { text: 'Removed the claim about the public', passage: 'to the public', side: 'old' },
    ])
  })

  it('drops "removed" when the passage names words from the new side', () => {
    const after = 'The tool is free to everyone. It runs fast. It is small.'
    expect(verifyNotes(['- Cut the old wording of the claim :: free to everyone'], OLD, after)).toEqual([])
  })

  it('keeps "merged" only when the sentence count fell', () => {
    const merged = 'The tool is free to the public and it runs fast. It is small.'
    expect(verifyNotes(['- Merged two sentences into one :: and it runs fast'], OLD, merged)).toHaveLength(1)
    const same = 'The tool is free to all. It runs fast. It is small.'
    expect(verifyNotes(['- Merged two sentences into one :: free to all'], OLD, same)).toEqual([])
  })

  it('keeps "split" only when the sentence count rose', () => {
    const split = 'The tool is free. It is for the public. It runs fast. It is small.'
    expect(verifyNotes(['- Split a long sentence in two :: It is for the public'], OLD, split)).toHaveLength(1)
    expect(verifyNotes(['- Split a long sentence in two :: free to all'], OLD, 'The tool is free to all. It runs fast. It is small.')).toEqual([])
  })
})
