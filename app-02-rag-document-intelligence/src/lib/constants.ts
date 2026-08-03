/** Target characters per chunk when splitting extracted document text. */
export const CHUNK_SIZE = 500

/** Characters of overlap carried between adjacent chunks. */
export const CHUNK_OVERLAP = 50

/** Slices shorter than this are punctuation/whitespace noise, not passages. */
export const MIN_CHUNK_CHARS = 20

/**
 * Passages sent to the model per question. Must stay <= MAX_CHUNKS in
 * netlify/functions/ai.ts, which rejects anything larger.
 */
export const TOP_K = 20

/** Chunks rendered on each side of the focused chunk in the document viewer. */
export const VIEWER_WINDOW = 30

/** Max upload size: 25 MB. */
export const MAX_FILE_SIZE = 25 * 1024 * 1024

/** Confidence at or above this reads as "High"; at or above MEDIUM reads as "Medium". */
export const CONFIDENCE_HIGH = 0.8
export const CONFIDENCE_MEDIUM = 0.5
