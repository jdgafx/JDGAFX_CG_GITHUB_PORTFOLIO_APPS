import { CHUNK_SIZE, CHUNK_OVERLAP, MIN_CHUNK_CHARS } from './constants'

/**
 * Marker written before each page by the extractor, as "--- Page N ---". Built fresh
 * per use because a shared /g regex carries state between calls.
 */
export const pageMarkerPattern = () => /--- Page (\d+) ---/g

interface PageStart {
  /** Where this page's text begins in the cleaned text. */
  offset: number
  page: number
}

/**
 * Removes every page marker and joins the page texts with single spaces. Each page
 * start is recorded as an offset into the cleaned text, so the page of any passage
 * can be read after the markers are gone. Markers never reach a passage, even when a
 * passage boundary falls inside one.
 */
function splitPages(text: string): { clean: string; starts: PageStart[] } {
  const pattern = pageMarkerPattern()
  const starts: PageStart[] = []
  let clean = ''
  let last = 0

  const append = (segment: string) => {
    const piece = segment.trim()
    if (piece === '') return
    clean = clean === '' ? piece : `${clean} ${piece}`
  }

  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    append(text.slice(last, match.index))
    starts.push({ offset: clean.length, page: Number(match[1]) })
    last = match.index + match[0].length
  }
  append(text.slice(last))
  return { clean, starts }
}

/** The document text with page markers removed. Used for the character count. */
export function stripPageMarkers(text: string): string {
  return splitPages(text).clean
}

interface ChunkedText {
  chunks: string[]
  /** Page number each chunk starts on, parallel to `chunks`. Text before any marker is page 1. */
  chunkPages: number[]
}

export function chunkText(text: string, maxChars: number = CHUNK_SIZE): ChunkedText {
  const { clean, starts } = splitPages(text)
  const chunks: string[] = []
  const chunkPages: number[] = []
  let start = 0
  // Chunk starts only move forward, so one cursor is enough to find each page.
  let pageCursor = 0

  while (start < clean.length) {
    let end = start + maxChars

    if (end < clean.length) {
      const searchWindow = clean.slice(end, Math.min(end + 120, clean.length))
      const sentenceEnd = searchWindow.search(/[.!?\n]/)
      if (sentenceEnd !== -1) {
        end = end + sentenceEnd + 1
      }
    } else {
      end = clean.length
    }

    const slice = clean.slice(start, end)
    const chunk = slice.trim()
    if (chunk.length > MIN_CHUNK_CHARS) {
      // Offset of the passage's first character, past any leading whitespace.
      const chunkStart = start + (slice.length - slice.trimStart().length)
      while (pageCursor + 1 < starts.length && (starts[pageCursor + 1]?.offset ?? Infinity) <= chunkStart) {
        pageCursor++
      }
      const page = starts[pageCursor]
      chunks.push(chunk)
      chunkPages.push(page && page.offset <= chunkStart ? page.page : 1)
    }

    // The final slice already reached the end of the document; advancing again
    // would emit a trailing chunk that only repeats the overlap window.
    if (end >= clean.length) break

    start = Math.max(start + Math.floor(maxChars / 2), end - CHUNK_OVERLAP)
  }

  return { chunks, chunkPages }
}
