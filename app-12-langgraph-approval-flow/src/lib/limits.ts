/** Limits shared by the browser and the server, so both give the same answer. Lengths count characters, not bytes. */
export const TITLE_MAX_LENGTH = 300
export const BODY_MAX_LENGTH = 6000
export const LABELS_MAX = 30
export const LABEL_MAX_LENGTH = 50
export const NOTE_MAX_LENGTH = 500
/** A maintainer may keep at most this many labels when editing. */
export const EDIT_LABELS_MAX = 8

/** The number of characters, counting a character outside the BMP once. */
export function lengthOf(text: string): number {
  return Array.from(text).length
}

/** The first `max` characters. Never splits a surrogate pair. */
export function clip(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : text
}
