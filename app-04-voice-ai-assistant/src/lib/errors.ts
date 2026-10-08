// An error whose message was written for the user. Any other error (a browser or
// library error) is shown as the calling step's fallback copy, never as its raw text.
export class UserFacingError extends Error {
  constructor(message: string, name = 'UserFacingError') {
    super(message)
    this.name = name
  }
}
