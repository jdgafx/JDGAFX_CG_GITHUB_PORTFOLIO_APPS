// A pick that failed leaves a message, tagged with how many image slots were empty at the time. Once an image
// arrives another way (upload, drop, paste) the count changes and the old message stops showing.
export interface PickError {
  message: string
  slotsLeft: number
}

export function visibleError(error: PickError | null, slotsLeft: number): string {
  return error && error.slotsLeft === slotsLeft ? error.message : ''
}
