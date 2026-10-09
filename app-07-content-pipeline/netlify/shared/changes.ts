// The change notes Edit and Polish return beside their text: the model writes the piece, then a fixed
// delimiter line, then 2 to 5 notes. Each note is "reason :: passage", where the passage is the words
// it is about. The server keeps a note only if its passage sits in text that really changed. Pure.

import { diffWords, sideWords, type DiffSegment } from './diff'
import { readability } from './readability'

export const CHANGES_DELIMITER = '---CHANGES---'
export const MAX_NOTES = 5
export const MIN_NOTES_ASKED = 4

export interface ChangeNote {
  text: string
  // The words the note is about, as they read in the new text ('new') or in the old one ('old').
  passage: string
  side: 'new' | 'old'
}

const DELIMITER_LINE = /^[ \t]*([-=])\1{2,}[ \t]*CHANGES[ \t]*\1{3,}[ \t]*$/im

export interface SplitReply {
  text: string
  // Lines after the delimiter; empty when the reply has none.
  noteLines: string[]
  hadDelimiter: boolean
}

// Cuts the reply at the delimiter. A reply without one is all text.
export function splitChanges(content: string): SplitReply {
  const match = DELIMITER_LINE.exec(content)
  if (!match) return { text: content.trim(), noteLines: [], hadDelimiter: false }
  const rest = content.slice(match.index + match[0].length)
  return {
    text: content.slice(0, match.index).trim(),
    noteLines: rest.split('\n').map(line => line.trim()).filter(Boolean),
    hadDelimiter: true,
  }
}

function normalize(word: string): string {
  return word.toLowerCase().replace(/\[\d{1,2}\]/g, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

function passageWords(passage: string): string[] {
  return passage.split(/\s+/).map(normalize).filter(Boolean)
}

// Finds the passage as a run of consecutive words; returns how many of them are changed words, or -1.
function changedShare(words: string[], side: { word: string; changed: boolean }[]): number {
  const text = side.map(item => normalize(item.word))
  let best = -1
  for (let i = 0; i + words.length <= text.length; i += 1) {
    if (words.every((word, k) => text[i + k] === word)) {
      const changed = side.slice(i, i + words.length).filter(item => item.changed).length
      best = Math.max(best, changed)
    }
  }
  return best
}

// What a reason says it did, read from its wording. Each claim has to hold in the text.
const REMOVAL = /\b(?:remov|drop|cut\b|delet|omit|eliminat|took out|stripp?)/i
const MERGE = /\b(?:merg|combin|join|fus)/i
const SPLIT = /\b(?:split|broke|break)/i

function sentencesIn(text: string): number {
  return readability(text)?.sentences ?? 0
}

// True when the reason's own claim is contradicted by the two texts.
function contradicted(reason: string, words: string[], side: 'new' | 'old', before: string, after: string, newSide: { word: string }[]): boolean {
  // "Removed X" is false if X is still there, and its words must be the removed ones.
  if (REMOVAL.test(reason)) {
    const text = newSide.map(item => normalize(item.word))
    const stillThere = words.length > 0 && text.some((_, i) => words.every((word, k) => text[i + k] === word))
    if (side !== 'old' || stillThere) return true
  }
  // "Merged" or "combined" sentences needs fewer sentences after; "split" needs more.
  if (MERGE.test(reason) && sentencesIn(after) >= sentencesIn(before)) return true
  if (SPLIT.test(reason) && sentencesIn(after) <= sentencesIn(before)) return true
  return false
}

const SEPARATOR = /\s::\s|\s\|\|\s/

/**
 * Keeps the notes whose passage really is in the changed text. A passage must be found word for word
 * in the new text or in the old text (the deleted words), and at least a quarter of its words, and at
 * least one, must be inserted (new side) or deleted (old side) in the diff. Notes with fewer than
 * three words of reason, with no passage, or whose passage was already used are dropped. A reason is also
 * dropped when its own claim is false: a removal whose words are still in the new text (or named on the new
 * side), "merged" when the sentence count did not fall, "split" when it did not rise.
 */
export function verifyNotes(noteLines: string[], before: string, after: string, segments: DiffSegment[] = diffWords(before, after)): ChangeNote[] {
  const newSide = sideWords(segments, 'new')
  const oldSide = sideWords(segments, 'old')
  const kept: ChangeNote[] = []
  const used = new Set<string>()
  for (const line of noteLines) {
    const cleaned = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\*\*/g, '')
    const parts = cleaned.split(SEPARATOR)
    if (parts.length < 2) continue
    const text = (parts[0] ?? '').trim()
    const passage = parts.slice(1).join(' ').trim().replace(/^["'“‘]+|["'”’]+$/g, '')
    const words = passageWords(passage)
    if (text.split(/\s+/).length < 3 || text.length > 220 || words.length === 0 || words.length > 40) continue
    const need = Math.max(1, Math.ceil(words.length / 4))
    const inNew = changedShare(words, newSide)
    const inOld = changedShare(words, oldSide)
    const side = inNew >= need ? 'new' : inOld >= need ? 'old' : null
    if (!side || contradicted(text, words, side, before, after, newSide)) continue
    const id = `${side}:${words.join(' ')}`
    if (used.has(id)) continue
    used.add(id)
    kept.push({ text, passage, side })
    if (kept.length === MAX_NOTES) break
  }
  return kept
}

// What the trace says about the notes, so a dropped note is never silent.
export function notesDetail(asked: number, kept: number, hadDelimiter: boolean): string {
  if (!hadDelimiter) return 'No change notes came back.'
  if (kept === 0) return asked === 0 ? 'No change notes came back.' : `No change note matched a real change (${asked} dropped).`
  return `${kept} of ${asked} change ${asked === 1 ? 'note' : 'notes'} kept.`
}
