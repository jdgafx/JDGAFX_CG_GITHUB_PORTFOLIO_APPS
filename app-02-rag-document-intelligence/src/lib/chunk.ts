import { CHUNK_SIZE, CHUNK_OVERLAP, MIN_CHUNK_CHARS } from './constants'

/**
 * Marker written between pages by the extractor so chunks can be traced back to
 * a page number. Built fresh per use because a shared /g regex carries state.
 */
export const pageMarkerPattern = () => /--- Page (\d+) ---/g

export interface ChunkedText {
  chunks: string[]
  /** Page number each chunk starts on, parallel to `chunks`. */
  chunkPages: number[]
}

interface PageMarker {
  offset: number
  page: number
}

function findPageMarkers(text: string): PageMarker[] {
  const markers: PageMarker[] = []
  const pattern = pageMarkerPattern()
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const page = Number(match[1])
    if (Number.isFinite(page)) markers.push({ offset: match.index, page })
  }
  return markers
}

export function chunkText(text: string, maxChars: number = CHUNK_SIZE): ChunkedText {
  const markers = findPageMarkers(text)
  const chunks: string[] = []
  const chunkPages: number[] = []
  let start = 0
  // Markers are in offset order and chunk starts only move forward, so a single
  // cursor is enough to find the nearest preceding page marker.
  let markerCursor = 0

  while (start < text.length) {
    let end = start + maxChars

    if (end < text.length) {
      const searchWindow = text.slice(end, Math.min(end + 120, text.length))
      const sentenceEnd = searchWindow.search(/[.!?\n]/)
      if (sentenceEnd !== -1) {
        end = end + sentenceEnd + 1
      }
    } else {
      end = text.length
    }

    const slice = text.slice(start, end)
    const chunk = slice.trim()
    if (chunk.length > MIN_CHUNK_CHARS) {
      // Offset of the chunk's first visible character. Trimming can skip past a
      // page marker, which would otherwise credit the chunk to the page before.
      const chunkStart = start + (slice.length - slice.trimStart().length)
      while (
        markerCursor + 1 < markers.length &&
        (markers[markerCursor + 1]?.offset ?? Infinity) <= chunkStart
      ) {
        markerCursor++
      }
      const marker = markers[markerCursor]
      chunks.push(chunk)
      chunkPages.push(marker && marker.offset <= chunkStart ? marker.page : 1)
    }

    // The final slice already reached the end of the document; advancing again
    // would emit a trailing chunk that only repeats the overlap window.
    if (end >= text.length) break

    start = Math.max(start + Math.floor(maxChars / 2), end - CHUNK_OVERLAP)
  }

  return { chunks, chunkPages }
}
