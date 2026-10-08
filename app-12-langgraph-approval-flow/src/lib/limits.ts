/** Limits shared by the form and the server, so both give the same answer. */
export const TICKET_MIN_LENGTH = 10
export const TICKET_MAX_LENGTH = 2000
export const NOTE_MAX_LENGTH = 500
export const TICKET_RULE = 'The ticket must be 10 to 2,000 characters.'

/** Null when the ticket is acceptable, otherwise the plain message to show. Length ignores surrounding space. */
export function ticketProblem(text: string): string | null {
  const length = [...text.trim()].length
  return length >= TICKET_MIN_LENGTH && length <= TICKET_MAX_LENGTH ? null : TICKET_RULE
}
