import { chunkText, stripPageMarkers } from './chunk'
import type { DocumentSource, DocumentState, LocationUnit } from '../types'

interface BuildInput {
  title: string
  source: DocumentSource
  /** Text with "--- Page N ---" markers. For a section unit, N is the section number. */
  text: string
  unit: LocationUnit
  pages: number
  sectionTitles?: string[]
}

/** Cuts the marked text into passages and records where each one starts. */
export function buildDocument({ title, source, text, unit, pages, sectionTitles = [] }: BuildInput): DocumentState {
  const { chunks, chunkPages } = chunkText(text)
  return { title, source, chunks, chunkPages, unit, pages, sectionTitles, charCount: stripPageMarkers(text).length }
}
