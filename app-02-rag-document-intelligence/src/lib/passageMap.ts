import type { RunState } from '../types'

/** 'passage' or 'passages', by count. */
function noun(count: number): string {
  return count === 1 ? 'passage' : 'passages'
}


/** Most cells the document map draws, so each stays wide enough to see. */
export const MAP_CELLS = 64

export interface MapCell {
  /** A passage in this cell went to the model for the latest question. */
  sent: boolean
  /** A passage in this cell is cited by the latest answer. */
  cited: boolean
}

/**
 * One cell per slice of the document, at most `maxCells`. A passage marks the cell
 * that holds it, so a cell reads as sent or cited when any passage in it is.
 */
export function mapCells(total: number, sent: number[], cited: number[], maxCells: number = MAP_CELLS): MapCell[] {
  const count = Math.min(total, maxCells)
  if (count <= 0) return []
  const cells: MapCell[] = Array.from({ length: count }, () => ({ sent: false, cited: false }))
  const cellOf = (index: number): MapCell | undefined =>
    index >= 0 && index < total ? cells[Math.min(count - 1, Math.floor((index * count) / total))] : undefined
  for (const index of sent) {
    const cell = cellOf(index)
    if (cell) cell.sent = true
  }
  for (const index of cited) {
    const cell = cellOf(index)
    if (cell) cell.cited = true
  }
  return cells
}

/** Where the list window sits along the document, as percentages of its length. */
export function viewRange(total: number, start: number, end: number): { left: number; width: number } {
  if (total <= 0) return { left: 0, width: 0 }
  return { left: (start / total) * 100, width: ((end - start) / total) * 100 }
}

/** Passage numbers as the reader sees them, one-based: "4, 9 and 17". */
function listNumbers(indices: number[]): string {
  const numbers = indices.map(i => String(i + 1))
  const last = numbers.pop() ?? ''
  return numbers.length === 0 ? last : `${numbers.join(', ')} and ${last}`
}

/** The line above the map: what the latest question sent and what its answer cites. */
export function sentSummary(total: number, sent: number[], cited: number[], state: RunState | null): string {
  const passages = total.toLocaleString('en-US')
  if (sent.length === 0) {
    return state === 'no-matches'
      ? 'No passage shares a word with the question, so the model was not called.'
      : `This document has ${passages} ${noun(total)}. Ask a question to see which ones go to the model.`
  }
  const sentLine = `The browser sent ${sent.length.toLocaleString('en-US')} of ${passages} ${noun(total)} to the model.`
  if (cited.length === 0) return sentLine
  const word = cited.length === 1 ? 'passage' : 'passages'
  return `${sentLine} The answer cites ${word} ${listNumbers(cited)}.`
}
