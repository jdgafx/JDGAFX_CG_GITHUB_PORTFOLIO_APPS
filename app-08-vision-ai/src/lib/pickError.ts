// A pick that failed leaves a message, tagged with which images were loaded at the time (their addresses, joined).
// Once any image is loaded or replaced another way (upload, drop, paste, Replace) the key changes and the old message
// stops showing.
export interface PickError {
  message: string
  loaded: string
}

export function visibleError(error: PickError | null, loaded: string): string {
  return error && error.loaded === loaded ? error.message : ''
}
