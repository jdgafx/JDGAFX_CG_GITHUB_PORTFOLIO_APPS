import { describe, it, expect } from 'vitest'
import { mapCells, sentSummary, viewRange } from '../../src/lib/passageMap'

describe('mapCells', () => {
  it('draws one cell per passage when the document fits the cell limit', () => {
    const cells = mapCells(4, [1], [1], 64)
    expect(cells).toHaveLength(4)
    expect(cells.map(c => c.sent)).toEqual([false, true, false, false])
    expect(cells.map(c => c.cited)).toEqual([false, true, false, false])
  })

  it('groups passages into at most maxCells slices and marks the slice holding each one', () => {
    const cells = mapCells(200, [0, 199], [150], 64)
    expect(cells).toHaveLength(64)
    expect(cells[0]?.sent).toBe(true)
    expect(cells[63]?.sent).toBe(true)
    // Passage 150 sits in slice floor(150 * 64 / 200) = 48.
    expect(cells[48]?.cited).toBe(true)
    expect(cells.filter(c => c.cited)).toHaveLength(1)
  })

  it('returns no cells for an empty document', () => {
    expect(mapCells(0, [], [])).toEqual([])
  })
})

describe('viewRange', () => {
  it('places the list window as percentages of the document', () => {
    expect(viewRange(200, 0, 50)).toEqual({ left: 0, width: 25 })
    expect(viewRange(200, 100, 150)).toEqual({ left: 50, width: 25 })
  })
})

describe('sentSummary', () => {
  it('says how many passages were sent and which ones the answer cites', () => {
    expect(sentSummary(214, [3, 8, 16], [8, 16], 'answered')).toBe(
      'The browser sent 3 of 214 passages to the model. The answer cites passages 9 and 17.',
    )
  })

  it('uses the singular when the document has one passage', () => {
    expect(sentSummary(1, [0], [0], 'answered')).toBe(
      'The browser sent 1 of 1 passage to the model. The answer cites passage 1.',
    )
  })

  it('uses the singular for one cited passage', () => {
    expect(sentSummary(10, [0], [0], 'answered')).toBe(
      'The browser sent 1 of 10 passages to the model. The answer cites passage 1.',
    )
  })

  it('explains when no passage matched', () => {
    expect(sentSummary(10, [], [], 'no-matches')).toBe(
      'No passage shares a word with the question, so the model was not called.',
    )
  })

  it('asks for a question before any run', () => {
    expect(sentSummary(10, [], [], null)).toBe(
      'This document has 10 passages. Ask a question to see which ones go to the model.',
    )
  })
})
